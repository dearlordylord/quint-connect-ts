import { Effect, Fiber } from "effect"
import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"

import { makeRunEvaluatorProcess } from "../src/cli/compiled-evaluator-adapter.js"
import { makePlatformProcessBoundary } from "../src/cli/platform-process.js"
import { makeRunQuintProcess } from "../src/cli/quint-cli-adapter.js"

// eslint-disable-next-line functional/no-mixed-types -- test command handles mix captured data with cancellation.
interface PendingCommand {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly callback: (error: Error | null, stdout: string) => void
  readonly kill: ReturnType<typeof vi.fn>
}

const makeBoundary = (platform: NodeJS.Platform) => {
  const commands: Array<PendingCommand> = []
  const killProcess = vi.fn()
  const exitListeners: Array<() => void> = []
  const removeExitListener = vi.fn((listener: () => void) => {
    const index = exitListeners.indexOf(listener)
    if (index >= 0) {
      exitListeners.splice(index, 1)
    }
  })
  const boundary = makePlatformProcessBoundary({
    platform,
    runCommand: (command, args, callback) => {
      const pending = { command, args, callback, kill: vi.fn() }
      commands.push(pending)
      return pending
    },
    killProcess,
    addExitListener: (listener) => exitListeners.push(listener),
    removeExitListener
  })
  return { boundary, commands, exitListeners, killProcess, removeExitListener }
}

class FakeProcess extends EventEmitter {
  readonly stdout = { resume: vi.fn() }
  readonly stderr = new EventEmitter()

  constructor(readonly pid: number) {
    super()
  }
}

class FakeEvaluatorProcess extends EventEmitter {
  readonly stdin = { write: vi.fn(), end: vi.fn() }
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()

  constructor(readonly pid: number) {
    super()
  }
}

describe("platform process boundary", () => {
  it("selects POSIX command names, evaluator names, and detached process groups", () => {
    const { boundary } = makeBoundary("linux")

    expect(boundary.commandName("quint")).toBe("quint")
    expect(boundary.commandName("npx")).toBe("npx")
    expect(boundary.executableName("quint_evaluator")).toBe("quint_evaluator")
    expect(boundary.detached).toBe(true)
    expect(boundary.evaluatorCleanupHint).toBe("killall -9 quint_evaluator")
  })

  it("selects Windows command shims, evaluator names, and attached processes", () => {
    const { boundary } = makeBoundary("win32")

    expect(boundary.commandName("quint")).toBe("quint.cmd")
    expect(boundary.commandName("npx")).toBe("npx.cmd")
    expect(boundary.executableName("quint_evaluator")).toBe("quint_evaluator.exe")
    expect(boundary.detached).toBe(false)
    expect(boundary.evaluatorCleanupHint).toBe("taskkill /F /T /IM quint_evaluator.exe")
  })

  it("falls back from quint.cmd to npx.cmd on Windows", async () => {
    const { boundary } = makeBoundary("win32")
    const spawned: Array<{ readonly command: string; readonly process: FakeProcess }> = []
    const run = makeRunQuintProcess((command) => {
      const child = new FakeProcess(100 + spawned.length)
      spawned.push({ command, process: child })
      return child
    }, boundary)
    const result = Effect.runPromise(run(["run", "counter.qnt"], false))

    spawned[0]?.process.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }))
    spawned[0]?.process.emit("close", 1)
    spawned[1]?.process.emit("close", 0)

    await expect(result).resolves.toEqual({ exitCode: 0, stderr: "" })
    expect(spawned.map(({ command }) => command)).toEqual(["quint.cmd", "npx.cmd"])
  })

  it("terminates a POSIX process group when interrupted", async () => {
    const { boundary, killProcess, removeExitListener } = makeBoundary("linux")
    const lifecycle = boundary.makeLifecycle(() => ({ pid: 42 }))

    await Effect.runPromise(lifecycle.interrupt)

    expect(killProcess).toHaveBeenCalledWith(-42, "SIGKILL")
    expect(removeExitListener).toHaveBeenCalledOnce()
  })

  it("terminates a Windows process tree with taskkill when interrupted", async () => {
    const { boundary, commands, removeExitListener } = makeBoundary("win32")
    const lifecycle = boundary.makeLifecycle(() => ({ pid: 43 }))
    const interrupted = Effect.runPromise(lifecycle.interrupt)

    expect(commands[0]).toMatchObject({
      command: "taskkill",
      args: ["/PID", "43", "/T", "/F"]
    })
    commands[0]?.callback(null, "")
    await interrupted

    expect(removeExitListener).toHaveBeenCalledOnce()
  })

  it("runs the compiled evaluator with portable Windows lifecycle settings", async () => {
    const { boundary, commands } = makeBoundary("win32")
    const process = new FakeEvaluatorProcess(46)
    const spawnProcess = vi.fn(() => process)
    const fiber = Effect.runFork(
      makeRunEvaluatorProcess(spawnProcess, boundary)("C:\\quint_evaluator.exe", "{}")
    )
    const interrupted = Effect.runPromise(Fiber.interrupt(fiber))

    expect(spawnProcess).toHaveBeenCalledWith(
      "C:\\quint_evaluator.exe",
      ["simulate-from-stdin"],
      { stdio: ["pipe", "pipe", "pipe"], detached: false }
    )
    expect(commands[0]).toMatchObject({ command: "taskkill", args: ["/PID", "46", "/T", "/F"] })
    commands[0]?.callback(null, "")
    await interrupted
  })

  it("uses synchronous best-effort cleanup when the host exits", () => {
    const posix = makeBoundary("linux")
    const windows = makeBoundary("win32")
    posix.boundary.makeLifecycle(() => ({ pid: 44 }))
    windows.boundary.makeLifecycle(() => ({ pid: 45 }))

    posix.exitListeners[0]?.()
    windows.exitListeners[0]?.()

    expect(posix.killProcess).toHaveBeenCalledWith(-44, "SIGKILL")
    expect(windows.killProcess).toHaveBeenCalledWith(45, "SIGKILL")
  })

  it("counts evaluator processes asynchronously on POSIX and Windows", async () => {
    const posix = makeBoundary("linux")
    const windows = makeBoundary("win32")
    const posixCount = Effect.runPromise(posix.boundary.countEvaluatorProcesses)
    const windowsCount = Effect.runPromise(windows.boundary.countEvaluatorProcesses)

    expect(posix.commands[0]).toMatchObject({ command: "pgrep", args: ["-c", "quint_evaluator"] })
    expect(windows.commands[0]).toMatchObject({
      command: "tasklist",
      args: ["/FI", "IMAGENAME eq quint_evaluator.exe", "/FO", "CSV", "/NH"]
    })
    posix.commands[0]?.callback(null, "2\n")
    windows.commands[0]?.callback(
      null,
      [
        "\"quint_evaluator.exe\",\"100\",\"Console\",\"1\",\"10,000 K\"",
        "\"quint_evaluator.exe\",\"101\",\"Console\",\"1\",\"10,000 K\""
      ].join("\r\n")
    )

    await expect(posixCount).resolves.toBe(2)
    await expect(windowsCount).resolves.toBe(2)
  })

  it("cancels an in-flight zombie check without waiting for the OS command", async () => {
    const { boundary, commands } = makeBoundary("win32")
    const fiber = Effect.runFork(boundary.countEvaluatorProcesses)

    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(commands[0]?.kill).toHaveBeenCalledOnce()
  })
})
