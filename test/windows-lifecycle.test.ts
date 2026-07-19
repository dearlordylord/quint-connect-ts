import { Effect, Schema } from "effect"
import { execFileSync, spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it, vi } from "vitest"

import { ITFBigInt } from "@firfi/itf-trace-parser/effect"

import { platformProcess } from "../src/cli/platform-process.js"
import { makeRunQuintProcess } from "../src/cli/quint-cli-adapter.js"
import { generateTraces } from "../src/cli/quint.js"

// Real-Windows lifecycle validation. Everything here exercises actual win32 command-shim
// spawning, PID/process-tree semantics, and cleanup finalizers, so it is skipped entirely
// on non-Windows hosts (developer machines, the Ubuntu CI matrix) and only runs on the
// dedicated `windows-2022` job. See issue #16.
const windows = describe.skipIf(process.platform !== "win32")

const specDir = path.resolve(import.meta.dirname, "specs")
const counterSpec = path.join(specDir, "counter.qnt")
const quintCmd = path.resolve(import.meta.dirname, "..", "node_modules", ".bin", "quint.cmd")

const CounterStateSchema = Schema.Struct({ count: ITFBigInt })

const baseOptions = {
  backend: "typescript" as const,
  maxSamples: 1,
  maxSteps: 3,
  nTraces: 1,
  seed: "1"
}

interface TreePids {
  readonly child: number
  readonly parent: number
}

const TreePids = Schema.Struct({ child: Schema.Number, parent: Schema.Number })

const isPidAlive = (pid: number): boolean => {
  const output = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true
  })
  return output.includes(`"${pid}"`)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const readTreePids = (file: string): TreePids | undefined => {
  if (!fs.existsSync(file)) {
    return undefined
  }
  const decoded = Schema.decodeUnknownOption(TreePids)(JSON.parse(fs.readFileSync(file, "utf8")))
  return decoded._tag === "Some" ? decoded.value : undefined
}

const waitFor = async <A>(probe: () => A | undefined, timeoutMs: number): Promise<A> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value !== undefined) {
      return value
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition")
    }
    await sleep(100)
  }
}

const waitUntil = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
  await waitFor(() => (predicate() ? true : undefined), timeoutMs)
}

const decodeCounterStates = (states: ReadonlyArray<unknown>) =>
  Effect.forEach(states, (state) => Schema.decodeUnknown(CounterStateSchema)(state))

// Minimal fake child used only for the fallback-command-selection assertion, so we can
// confirm the real win32 boundary resolves `npx.cmd` without ever launching real npx (no
// @informalsystems/quint registry download).
class FakeQuintProcess extends EventEmitter {
  readonly stdout = { resume: () => undefined }
  readonly stderr = new EventEmitter()

  constructor(readonly pid: number) {
    super()
  }
}

windows("Windows Quint process lifecycle", () => {
  it("resolves the Windows command shims", () => {
    expect(platformProcess.commandName("quint")).toBe("quint.cmd")
    expect(platformProcess.commandName("npx")).toBe("npx.cmd")
    expect(platformProcess.detached).toBe(false)
  })

  it("generates and decodes a real trace via default PATH lookup", async () => {
    const traces = await Effect.runPromise(generateTraces({ ...baseOptions, spec: counterSpec }))
    expect(traces.length).toBeGreaterThan(0)
    const states = traces[0]?.states ?? []
    expect(states.length).toBeGreaterThan(0)
    const decoded = await Effect.runPromise(decodeCounterStates(states))
    for (const state of decoded) {
      expect(typeof state.count).toBe("bigint")
    }
  }, 60000)

  it("generates a real trace with an explicit quintBin pointing at quint.cmd", async () => {
    expect(fs.existsSync(quintCmd)).toBe(true)
    const traces = await Effect.runPromise(
      generateTraces({ ...baseOptions, quintBin: quintCmd, spec: counterSpec })
    )
    expect(traces.length).toBeGreaterThan(0)
  }, 60000)

  it("handles spec and trace-dir paths containing spaces", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quint connect "))
    try {
      const spacedSpec = path.join(dir, "counter spec.qnt")
      fs.copyFileSync(counterSpec, spacedSpec)
      const traceDir = path.join(dir, "trace out")
      const traces = await Effect.runPromise(
        generateTraces({ ...baseOptions, spec: spacedSpec, traceDir })
      )
      expect(traces.length).toBeGreaterThan(0)
    } finally {
      fs.rmSync(dir, { force: true, recursive: true })
    }
  }, 60000)

  it("terminates the whole child process tree on interrupt", async () => {
    const fixture = path.resolve(import.meta.dirname, "fixtures", "windows-process-tree.mjs")
    const outFile = path.join(os.tmpdir(), `qc-tree-${process.pid}-${Date.now()}.json`)
    const child = spawn(process.execPath, [fixture, outFile], {
      detached: platformProcess.detached,
      stdio: "ignore",
      windowsHide: true
    })
    try {
      const pids = await waitFor(() => readTreePids(outFile), 15000)
      expect(isPidAlive(pids.parent)).toBe(true)
      expect(isPidAlive(pids.child)).toBe(true)

      const lifecycle = platformProcess.makeLifecycle(() => ({ pid: child.pid }))
      await Effect.runPromise(lifecycle.interrupt)

      await waitUntil(() => !isPidAlive(pids.parent) && !isPidAlive(pids.child), 15000)
      expect(isPidAlive(pids.parent)).toBe(false)
      expect(isPidAlive(pids.child)).toBe(false)
    } finally {
      try {
        child.kill()
      } catch {
        // Already terminated by the tree kill above.
      }
      fs.rmSync(outFile, { force: true })
    }
  }, 30000)

  it("removes lifecycle listeners after a completed trace generation", async () => {
    const before = {
      exit: process.listenerCount("exit"),
      sigint: process.listenerCount("SIGINT"),
      sigterm: process.listenerCount("SIGTERM")
    }
    await Effect.runPromise(generateTraces({ ...baseOptions, spec: counterSpec }))
    expect(process.listenerCount("exit")).toBe(before.exit)
    expect(process.listenerCount("SIGINT")).toBe(before.sigint)
    expect(process.listenerCount("SIGTERM")).toBe(before.sigterm)
  }, 60000)

  it("selects npx.cmd as the fallback command without a registry download", async () => {
    const spawned: Array<
      { readonly args: ReadonlyArray<string>; readonly command: string; readonly proc: FakeQuintProcess }
    > = []
    const run = makeRunQuintProcess((command, args) => {
      const proc = new FakeQuintProcess(500 + spawned.length)
      spawned.push({ args, command, proc })
      return proc
    }, platformProcess)
    const result = Effect.runPromise(run(["run", "counter.qnt"], false))

    spawned[0]?.proc.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }))
    spawned[0]?.proc.emit("close", 1)
    await vi.waitFor(() => expect(spawned).toHaveLength(2))
    // Selection-only: complete the fake npx attempt so nothing real is ever launched.
    spawned[1]?.proc.emit("close", 0)

    await expect(result).resolves.toEqual({ exitCode: 0, stderr: "" })
    expect(spawned.map(({ command }) => command)).toEqual(["quint.cmd", "npx.cmd"])
    expect(spawned[1]?.args).toEqual(["@informalsystems/quint", "run", "counter.qnt"])
  })
})
