import { Effect } from "effect"
import { EventEmitter } from "node:events"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  makeCompiledEvaluatorTraceAdapter,
  normalizeEvaluatorOutput,
  patchCompiledEvaluatorInput
} from "../src/cli/compiled-evaluator-adapter.js"
import { buildRunArgs, makeQuintCliTraceAdapter, makeRunQuintProcess } from "../src/cli/quint-cli-adapter.js"
import { readTraceFiles, writeTraceFiles } from "../src/cli/trace-files.js"

const withTempDir = async <A>(run: (dir: string) => Promise<A>): Promise<A> => {
  const dir = await mkdtemp(join(tmpdir(), "qc-trace-test-"))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

class FakeProcess extends EventEmitter {
  readonly stdout = { resume: vi.fn() }
  readonly stderr = new EventEmitter()

  constructor(readonly pid: number) {
    super()
  }
}

describe("trace file helpers", () => {
  it("writes normalized traces and reads them through the shared parser", async () => {
    await withTempDir(async (dir) => {
      await Effect.runPromise(writeTraceFiles(dir, [{
        vars: ["counter"],
        states: [{ counter: 2n }]
      }]))

      const raw = await readFile(join(dir, "trace_0.itf.json"), "utf-8")
      expect(JSON.parse(raw)).toEqual({
        vars: ["counter"],
        states: [{ counter: { "#bigint": "2" } }]
      })

      const traces = await Effect.runPromise(readTraceFiles(dir))
      expect(traces).toHaveLength(1)
      expect(traces[0]?.states[0]).toEqual({ counter: { "#bigint": "2" } })
    })
  })
})

describe("Quint CLI trace adapter", () => {
  it("preserves run argument defaults for seeded Quint execution", () => {
    const args = buildRunArgs({
      spec: "counter.qnt",
      seed: "abc",
      maxSteps: 3,
      invariants: ["Inv"],
      witnesses: ["Witness"]
    }, "/tmp/traces")

    expect(args).toEqual([
      "run",
      "counter.qnt",
      "--mbt",
      "--n-traces",
      "10",
      "--out-itf",
      "/tmp/traces/trace_{seq}.itf.json",
      "--backend",
      "typescript",
      "--seed",
      "abc",
      "--max-steps",
      "3",
      "--max-samples",
      "10000",
      "--invariant",
      "Inv",
      "--witness",
      "Witness"
    ])
  })

  it("reads generated trace files without invoking a real Quint binary", async () => {
    await withTempDir(async (dir) => {
      const runQuintProcess = vi.fn((args: ReadonlyArray<string>) => {
        const outPattern = args[args.indexOf("--out-itf") + 1]
        const outPath = outPattern.replace("{seq}", "0")
        return Effect.promise(async () => {
          await writeFile(
            outPath,
            JSON.stringify({
              vars: ["counter"],
              states: [{ counter: { "#bigint": "1" } }]
            })
          )
          return { exitCode: 0, stderr: "" }
        })
      })
      const adapter = makeQuintCliTraceAdapter({ runQuintProcess })

      const traces = await Effect.runPromise(adapter.generate({ spec: "counter.qnt" }, dir))

      expect(runQuintProcess).toHaveBeenCalledOnce()
      expect(traces).toHaveLength(1)
      expect(traces[0]?.states[0]).toEqual({ counter: { "#bigint": "1" } })
    })
  })

  it("ignores the original quint close after ENOENT fallback starts npx", async () => {
    const spawned: Array<{ readonly cmd: string; readonly args: ReadonlyArray<string>; readonly proc: FakeProcess }> =
      []
    const spawnProcess = vi.fn((cmd: string, args: ReadonlyArray<string>) => {
      const proc = new FakeProcess(1000 + spawned.length)
      spawned.push({ cmd, args, proc })
      return proc
    })
    const runQuintProcess = makeRunQuintProcess(spawnProcess)
    const resultPromise = Effect.runPromise(runQuintProcess(["run", "counter.qnt"], false))

    const quintProc = spawned.at(0)?.proc
    if (quintProc === undefined) {
      throw new Error("expected quint process")
    }
    const enoent = Object.assign(new Error("quint not found"), { code: "ENOENT" })
    quintProc.emit("error", enoent)
    const fallbackProc = spawned.at(1)?.proc
    if (fallbackProc === undefined) {
      throw new Error("expected npx fallback process")
    }

    expect(spawned[1]?.cmd).toBe("npx")
    expect(spawned[1]?.args).toEqual(["@informalsystems/quint", "run", "counter.qnt"])

    quintProc.emit("close", 1)
    fallbackProc.emit("close", 0)

    await expect(resultPromise).resolves.toEqual({ exitCode: 0, stderr: "" })
  })
})

describe("compiled evaluator trace adapter", () => {
  it("patches evaluator runtime parameters and seed", () => {
    const result = patchCompiledEvaluatorInput(
      "{\"nruns\":1,\"nsteps\":1,\"ntraces\":1,\"nthreads\":1,\"seed\":null}",
      { spec: "counter.qnt", maxSamples: 7, maxSteps: 5, nTraces: 2, seed: "0x0f" },
      4,
      "000000000000000a"
    )

    expect(result).toEqual({
      input: "{\"nruns\":7,\"nsteps\":5,\"ntraces\":2,\"nthreads\":4,\"seed\":15}",
      seedHex: "0xf"
    })
  })

  it("patches decimal seeds as decimal and prefixed hex seeds as hex", () => {
    const rawInput = "{\"nruns\":1,\"nsteps\":1,\"ntraces\":1,\"nthreads\":1,\"seed\":null}"
    const decimal = patchCompiledEvaluatorInput(rawInput, { spec: "counter.qnt", seed: "42" }, 4, "a")
    const hex = patchCompiledEvaluatorInput(rawInput, { spec: "counter.qnt", seed: "0x42" }, 4, "a")

    expect(decimal.input).toBe("{\"nruns\":10000,\"nsteps\":10,\"ntraces\":10,\"nthreads\":4,\"seed\":42}")
    expect(decimal.seedHex).toBe("0x2a")
    expect(hex.input).toBe("{\"nruns\":10000,\"nsteps\":10,\"ntraces\":10,\"nthreads\":4,\"seed\":66}")
    expect(hex.seedHex).toBe("0x42")
  })

  it("injects a seed when compiled input has no seed field", () => {
    const result = patchCompiledEvaluatorInput(
      "{\"nruns\":1,\"nsteps\":1,\"ntraces\":1,\"nthreads\":1}",
      { spec: "counter.qnt" },
      4,
      "000000000000000a"
    )

    expect(result.input).toBe("{\"nruns\":10000,\"nsteps\":10,\"ntraces\":10,\"nthreads\":4,\"seed\":10}")
    expect(result.seedHex).toBe("0xa")
  })

  it("normalizes evaluator stdout to Quint out-itf trace shape", async () => {
    const traces = await Effect.runPromise(normalizeEvaluatorOutput(`
progress
{"status":"ok","bestTraces":[{"states":{"#meta":{"format":"ITF"},"params":[],"vars":["counter"],"states":[{"counter":3}]}}]}
`))

    expect(traces).toEqual([{
      "#meta": { format: "ITF" },
      vars: ["counter"],
      states: [{ counter: 3n }]
    }])
  })

  it("normalizes large evaluator integers without precision loss", async () => {
    const traces = await Effect.runPromise(normalizeEvaluatorOutput(`
{"status":"ok","bestTraces":[{"states":{"vars":["counter"],"states":[{"counter":9007199254740993}]}}]}
`))

    expect(traces).toEqual([{
      vars: ["counter"],
      states: [{ counter: 9007199254740993n }]
    }])
  })

  it("runs with fake evaluator dependencies and the shared trace reader", async () => {
    await withTempDir(async (dir) => {
      let evaluatorInput = ""
      const adapter = makeCompiledEvaluatorTraceAdapter({
        compiledInputExists: () => true,
        cpuCount: () => 8,
        getEvaluatorPath: () => "/fake/quint_evaluator",
        randomSeedHex: () => "000000000000000a",
        readCompiledInput: () =>
          Effect.succeed("{\"nruns\":1,\"nsteps\":1,\"ntraces\":1,\"nthreads\":1,\"seed\":null}"),
        runEvaluator: (_evaluatorPath, input) => {
          evaluatorInput = input
          return Effect.succeed({
            exitCode: 0,
            stderr: "",
            stdout:
              "{\"status\":\"ok\",\"bestTraces\":[{\"states\":{\"vars\":[\"counter\"],\"states\":[{\"counter\":4}]}}]}"
          })
        }
      })

      const traces = await Effect.runPromise(adapter.generate({
        spec: "counter.qnt",
        compiledInput: "compiled.json",
        maxSamples: 3,
        maxSteps: 6,
        nTraces: 1
      }, dir))

      expect(evaluatorInput).toBe("{\"nruns\":3,\"nsteps\":6,\"ntraces\":1,\"nthreads\":3,\"seed\":10}")
      expect(traces).toHaveLength(1)
      expect(traces[0]?.states[0]).toEqual({ counter: { "#bigint": "4" } })
    })
  })
})
