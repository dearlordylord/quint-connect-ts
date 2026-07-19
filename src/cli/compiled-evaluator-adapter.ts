import spawn from "cross-spawn"
import { Effect } from "effect"
import { existsSync, readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { cpus, homedir } from "node:os"
import { join } from "node:path"

import {
  decodeCompiledEvaluatorInput,
  makeRandomSeedHex,
  patchCompiledEvaluatorInput
} from "./compiled-evaluator-input.js"
import { normalizeEvaluatorOutput } from "./compiled-evaluator-output.js"
import { QuintError, QuintNotFoundError } from "./errors.js"
import { platformProcess } from "./platform-process.js"
import type { PlatformProcessBoundary } from "./platform-process.js"
import type { TraceGenerationAdapter } from "./trace-adapter.js"
import { readTraceFiles, writeTraceFiles } from "./trace-files.js"

interface EvaluatorResult {
  readonly stdout: string
  readonly exitCode: number
  readonly stderr: string
}

// eslint-disable-next-line functional/no-mixed-types -- process handles mix data fields and event methods.
interface EvaluatorProcess {
  readonly pid?: number | undefined
  readonly stdin: {
    readonly write: (input: string) => unknown
    readonly end: () => unknown
  }
  readonly stdout: {
    readonly on: (event: "data", listener: (chunk: Buffer) => void) => unknown
  }
  readonly stderr: {
    readonly on: (event: "data", listener: (chunk: Buffer) => void) => unknown
  }
  readonly on: {
    (event: "close", listener: (code: number | null) => void): unknown
    (event: "error", listener: (error: Error) => void): unknown
  }
}

type SpawnEvaluatorProcess = (
  evaluatorPath: string,
  args: ReadonlyArray<string>,
  options: { readonly stdio: ["pipe", "pipe", "pipe"]; readonly detached: boolean }
) => EvaluatorProcess

interface CompiledEvaluatorAdapterDeps {
  readonly compiledInputExists: (path: string) => boolean
  readonly cpuCount: () => number
  readonly getEvaluatorPath: () => string
  readonly randomSeedHex: () => string
  readonly readCompiledInput: (path: string) => Effect.Effect<string, QuintError>
  readonly runEvaluator: (
    evaluatorPath: string,
    inputStr: string
  ) => Effect.Effect<EvaluatorResult, QuintNotFoundError>
}

const getRustEvaluatorPath = (
  processBoundary: PlatformProcessBoundary = platformProcess
): string => {
  const quintDir = join(homedir(), ".quint")
  if (!existsSync(quintDir)) {
    throw new Error(`Quint home directory not found: ${quintDir}`)
  }
  const preferredVersion = process.env["QUINT_EVALUATOR_VERSION"]
  const dirs = readdirSync(quintDir).filter((dir) => dir.startsWith("rust-evaluator-")).sort()
  if (dirs.length === 0) {
    throw new Error("No Rust evaluator found in ~/.quint/. Run `quint run` once with --backend rust to download it.")
  }
  const preferred = preferredVersion
    ? dirs.find((dir) => dir.includes(preferredVersion))
    : undefined
  const latest = preferred ?? dirs[dirs.length - 1]
  const exePath = join(quintDir, latest, processBoundary.executableName("quint_evaluator"))
  if (!existsSync(exePath)) {
    throw new Error(`Rust evaluator binary not found: ${exePath}`)
  }
  return exePath
}

export const makeRunEvaluatorProcess = (
  spawnProcess: SpawnEvaluatorProcess = (evaluatorPath, args, options) => {
    const proc = spawn(evaluatorPath, [...args], options)
    if (proc.stdin === null || proc.stdout === null || proc.stderr === null) {
      throw new Error("Rust evaluator was spawned without piped stdio")
    }
    return {
      pid: proc.pid,
      stdin: proc.stdin,
      stdout: proc.stdout,
      stderr: proc.stderr,
      on: proc.on.bind(proc)
    }
  },
  processBoundary: PlatformProcessBoundary = platformProcess
) =>
(
  evaluatorPath: string,
  inputStr: string
): Effect.Effect<EvaluatorResult, QuintNotFoundError> =>
  Effect.callback((resume) => {
    let stdout = ""
    let stderr = ""
    const proc = spawnProcess(evaluatorPath, ["simulate-from-stdin"], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: processBoundary.detached
    })

    const lifecycle = processBoundary.makeLifecycle(() => proc)

    proc.stdin.write(inputStr)
    proc.stdin.end()

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on("close", (code) => {
      lifecycle.complete()
      resume(Effect.succeed({ stdout, exitCode: code ?? 1, stderr }))
    })
    proc.on("error", (e) => {
      lifecycle.complete()
      resume(Effect.fail(new QuintNotFoundError({ message: `Failed to start Rust evaluator: ${e}` })))
    })
    return lifecycle.interrupt
  })

const runEvaluatorDirect = makeRunEvaluatorProcess()

const defaultDeps: CompiledEvaluatorAdapterDeps = {
  compiledInputExists: existsSync,
  cpuCount: () => cpus().length,
  getEvaluatorPath: getRustEvaluatorPath,
  randomSeedHex: makeRandomSeedHex,
  readCompiledInput: (compiledInputPath) =>
    Effect.tryPromise({
      try: () => readFile(compiledInputPath, "utf-8"),
      catch: (e) => new QuintError({ message: `Failed to read compiled input: ${e}` })
    }),
  runEvaluator: runEvaluatorDirect
}

export const makeCompiledEvaluatorTraceAdapter = (
  deps: CompiledEvaluatorAdapterDeps = defaultDeps
): TraceGenerationAdapter => ({
  canGenerate: (opts) => opts.compiledInput !== undefined && deps.compiledInputExists(opts.compiledInput),
  generate: (opts, outDir) =>
    Effect.gen(function*() {
      if (opts.compiledInput === undefined) {
        return yield* new QuintError({ message: "Compiled input path is required for compiled evaluator generation" })
      }
      const rawInput = yield* deps.readCompiledInput(opts.compiledInput)
      const compiledInput = yield* decodeCompiledEvaluatorInput(rawInput)
      const { input, seedHex } = patchCompiledEvaluatorInput(
        compiledInput,
        opts,
        deps.cpuCount(),
        deps.randomSeedHex()
      )
      console.error(`[quint-connect] seed: ${seedHex} (compiled-input path)`)

      const evaluatorPath = yield* Effect.try({
        try: deps.getEvaluatorPath,
        catch: (e) => new QuintError({ message: `Failed to locate Rust evaluator: ${e}` })
      })
      const result = yield* deps.runEvaluator(evaluatorPath, input)
      if (result.exitCode !== 0) {
        return yield* new QuintError({
          message: `Rust evaluator failed with exit code ${result.exitCode}:\n${result.stderr}`,
          stderr: result.stderr,
          exitCode: result.exitCode
        })
      }

      const traces = yield* normalizeEvaluatorOutput(result.stdout)
      yield* writeTraceFiles(outDir, traces)
      return yield* readTraceFiles(outDir)
    })
})

export const compiledEvaluatorTraceAdapter: TraceGenerationAdapter = makeCompiledEvaluatorTraceAdapter()

export { decodeCompiledEvaluatorInput, patchCompiledEvaluatorInput } from "./compiled-evaluator-input.js"
export { normalizeEvaluatorOutput } from "./compiled-evaluator-output.js"
