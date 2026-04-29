import { Effect } from "effect"
import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { cpus, homedir } from "node:os"
import { join } from "node:path"

import { QuintError, QuintNotFoundError } from "./errors.js"
import type { RunOptions } from "./run-options.js"
import { DEFAULT_MAX_SAMPLES, DEFAULT_MAX_STEPS, DEFAULT_N_TRACES } from "./run-options.js"
import type { TraceGenerationAdapter } from "./trace-adapter.js"
import type { ItfTraceJson } from "./trace-files.js"
import { readTraceFiles, writeTraceFiles } from "./trace-files.js"

const RANDOM_SEED_HEX_LENGTH = 16
const HEX_RADIX = 16
const MIN_EVALUATOR_THREADS = 2

interface EvaluatorResult {
  readonly stdout: string
  readonly exitCode: number
  readonly stderr: string
}

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

interface PatchedCompiledInput {
  readonly input: string
  readonly seedHex: string
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

const formatEvaluatorError = (error: unknown): string =>
  isRecord(error) && typeof error["message"] === "string" ? error["message"] : String(error)

const defaultRandomSeedHex = (): string =>
  Array.from(
    { length: RANDOM_SEED_HEX_LENGTH },
    () => Math.floor(Math.random() * HEX_RADIX).toString(HEX_RADIX)
  ).join("")

const getRustEvaluatorPath = (): string => {
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
  const exePath = join(quintDir, latest, "quint_evaluator")
  if (!existsSync(exePath)) {
    throw new Error(`Rust evaluator binary not found: ${exePath}`)
  }
  return exePath
}

const runEvaluatorDirect = (
  evaluatorPath: string,
  inputStr: string
): Effect.Effect<EvaluatorResult, QuintNotFoundError> =>
  Effect.async((resume) => {
    let stdout = ""
    let stderr = ""
    const proc = spawn(evaluatorPath, ["simulate-from-stdin"], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true
    })

    const killGroup = () => {
      try {
        process.kill(-proc.pid!, "SIGKILL")
      } catch {
        // already dead
      }
    }
    process.on("exit", killGroup)

    proc.stdin.write(inputStr)
    proc.stdin.end()

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on("close", (code) => {
      process.removeListener("exit", killGroup)
      resume(Effect.succeed({ stdout, exitCode: code ?? 1, stderr }))
    })
    proc.on("error", (e) => {
      process.removeListener("exit", killGroup)
      resume(Effect.fail(new QuintNotFoundError({ message: `Failed to start Rust evaluator: ${e}` })))
    })
    return Effect.sync(() => {
      process.removeListener("exit", killGroup)
      killGroup()
    })
  })

const defaultDeps: CompiledEvaluatorAdapterDeps = {
  compiledInputExists: existsSync,
  cpuCount: () => cpus().length,
  getEvaluatorPath: getRustEvaluatorPath,
  randomSeedHex: defaultRandomSeedHex,
  readCompiledInput: (compiledInputPath) =>
    Effect.tryPromise({
      try: () => readFile(compiledInputPath, "utf-8"),
      catch: (e) => new QuintError({ message: `Failed to read compiled input: ${e}` })
    }),
  runEvaluator: runEvaluatorDirect
}

export const patchCompiledEvaluatorInput = (
  rawInput: string,
  opts: RunOptions,
  cpuCount: number,
  randomSeedHex: string
): PatchedCompiledInput => {
  const nTraces = opts.nTraces ?? DEFAULT_N_TRACES
  const maxSamples = opts.maxSamples ?? DEFAULT_MAX_SAMPLES
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
  const nThreads = Math.max(MIN_EVALUATOR_THREADS, Math.min(maxSamples, cpuCount))

  let patchedInput = rawInput
    .replace(/"nruns":\s*\d+/, `"nruns":${maxSamples}`)
    .replace(/"nsteps":\s*\d+/, `"nsteps":${maxSteps}`)
    .replace(/"ntraces":\s*\d+/, `"ntraces":${nTraces}`)
    .replace(/"nthreads":\s*\d+/, `"nthreads":${nThreads}`)

  const seedBigint = opts.seed !== undefined
    ? (opts.seed.startsWith("0x") ? BigInt(opts.seed) : BigInt(`0x${opts.seed}`))
    : BigInt(`0x${randomSeedHex}`)
  const seedHex = `0x${seedBigint.toString(HEX_RADIX)}`
  const seedReplaced = patchedInput.replace(/"seed":\s*(?:null|undefined|\d+)/, `"seed":${seedBigint}`)
  patchedInput = seedReplaced === patchedInput
    ? patchedInput.replace(/}\s*$/, `,"seed":${seedBigint}}`)
    : seedReplaced

  return { input: patchedInput, seedHex }
}

export const normalizeEvaluatorOutput = (
  stdout: string
): Effect.Effect<ReadonlyArray<ItfTraceJson>, QuintError> =>
  Effect.gen(function*() {
    const jsonLine = stdout.split("\n").filter((line) => line.trimStart().startsWith("{")).pop()
    if (jsonLine === undefined) {
      return yield* new QuintError({ message: "No JSON output from Rust evaluator" })
    }

    const parsed: unknown = yield* Effect.try({
      try: () =>
        JSON.parse(jsonLine, (_key, value: unknown) =>
          typeof value === "number" && Number.isInteger(value) ? BigInt(value) : value),
      catch: (e) =>
        new QuintError({ message: `Failed to parse evaluator output: ${e}` })
    })

    if (isRecord(parsed) && parsed["status"] === "error") {
      const errors = Array.isArray(parsed["errors"]) ? parsed["errors"] : []
      return yield* new QuintError({
        message: `Quint simulation error:\n${errors.map(formatEvaluatorError).join("\n")}`
      })
    }

    const bestTraces = isRecord(parsed) && Array.isArray(parsed["bestTraces"]) ? parsed["bestTraces"] : []
    return bestTraces.flatMap((bestTrace): ReadonlyArray<ItfTraceJson> => {
      if (!isRecord(bestTrace) || !isRecord(bestTrace["states"])) {
        return []
      }
      const statesObj = bestTrace["states"]
      const trace: Record<string, unknown> = {
        vars: statesObj["vars"],
        states: statesObj["states"]
      }
      if (Object.hasOwn(statesObj, "#meta")) {
        trace["#meta"] = statesObj["#meta"]
      }
      return [trace]
    })
  })

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
      const { input, seedHex } = patchCompiledEvaluatorInput(rawInput, opts, deps.cpuCount(), deps.randomSeedHex())
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
