import { Effect, Schema } from "effect"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ItfTrace } from "../itf/schema.js"

export class QuintError extends Schema.TaggedErrorClass<QuintError>()("QuintError", {
  message: Schema.String,
  stderr: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number)
}) {}

export class QuintNotFoundError extends Schema.TaggedErrorClass<QuintNotFoundError>()("QuintNotFoundError", {
  message: Schema.String
}) {}

export interface RunOptions {
  readonly spec: string
  readonly seed?: string | undefined
  readonly nTraces?: number | undefined
  readonly maxSteps?: number | undefined
  readonly maxSamples?: number | undefined
  readonly init?: string | undefined
  readonly step?: string | undefined
  readonly main?: string | undefined
  readonly invariants?: ReadonlyArray<string> | undefined
  readonly witnesses?: ReadonlyArray<string> | undefined
  readonly backend?: "typescript" | "rust" | undefined
  readonly verbose?: boolean | undefined
  readonly traceDir?: string | undefined
}

const DEFAULT_N_TRACES = 10
// quint defaults maxSamples to 1 when --seed is provided; use the non-seed default instead
const DEFAULT_MAX_SAMPLES = 10000

const buildRunArgs = (
  opts: RunOptions,
  outDir: string
): Array<string> => {
  const nTraces = opts.nTraces ?? DEFAULT_N_TRACES
  const args: Array<string> = [
    "run",
    opts.spec,
    "--mbt",
    "--n-traces",
    String(nTraces),
    "--out-itf",
    `${outDir}/trace_{seq}.itf.json`
  ]
  const envBackend = process.env["QUINT_BACKEND"]
  const backend = opts.backend ?? (envBackend === "typescript" || envBackend === "rust" ? envBackend : "typescript")
  args.push("--backend", backend)
  if (opts.seed !== undefined) {
    args.push("--seed", opts.seed)
  }
  if (opts.maxSteps !== undefined) {
    args.push("--max-steps", String(opts.maxSteps))
  }
  if (opts.maxSamples !== undefined) {
    args.push("--max-samples", String(opts.maxSamples))
  } else if (opts.seed !== undefined) {
    args.push("--max-samples", String(DEFAULT_MAX_SAMPLES))
  }
  if (opts.init !== undefined) {
    args.push("--init", opts.init)
  }
  if (opts.step !== undefined) {
    args.push("--step", opts.step)
  }
  if (opts.main !== undefined) {
    args.push("--main", opts.main)
  }
  if (opts.invariants !== undefined) {
    for (const inv of opts.invariants) {
      args.push("--invariant", inv)
    }
  }
  if (opts.witnesses !== undefined) {
    for (const wit of opts.witnesses) {
      args.push("--witness", wit)
    }
  }
  return args
}

const runQuintProcess = (
  args: ReadonlyArray<string>,
  verbose: boolean
): Effect.Effect<{ readonly exitCode: number; readonly stderr: string }, QuintNotFoundError> =>
  Effect.callback<{ readonly exitCode: number; readonly stderr: string }, QuintNotFoundError>((resume, signal) => {
    const env = verbose ? { ...process.env, QUINT_VERBOSE: "true" } : process.env
    const proc = spawn("npx", ["@informalsystems/quint", ...args], { env })
    let stderr = ""
    proc.stdout.resume()
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on("close", (code) => resume(Effect.succeed({ exitCode: code ?? 1, stderr })))
    proc.on("error", (e) => resume(Effect.fail(new QuintNotFoundError({ message: `Failed to start quint: ${e}` }))))
    signal.addEventListener("abort", () => {
      proc.kill()
    })
  })

const runAndReadTraces = (
  opts: RunOptions,
  outDir: string
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> =>
  Effect.gen(function*() {
    const args = buildRunArgs(opts, outDir)
    const { exitCode, stderr } = yield* runQuintProcess(args, opts.verbose === true)
    if (exitCode !== 0) {
      return yield* new QuintError({
        message: stderr
          ? `quint run failed with exit code ${exitCode}:\n${stderr.trim()}`
          : `quint run failed with exit code ${exitCode}`,
        stderr,
        exitCode
      })
    }
    const files = yield* Effect.tryPromise({
      try: () => readdir(outDir),
      catch: (e) => new QuintError({ message: `Failed to read trace directory: ${e}` })
    })
    const traceFiles = files
      .filter((f: string) => f.endsWith(".itf.json"))
      .sort()
    const traces: Array<ItfTrace> = []
    for (const file of traceFiles) {
      const content = yield* Effect.tryPromise({
        try: () => readFile(join(outDir, file), "utf-8"),
        catch: (e) => new QuintError({ message: `Failed to read trace file ${file}: ${e}` })
      })
      const json: unknown = yield* Effect.try({
        try: () => JSON.parse(content),
        catch: (e) => new QuintError({ message: `Invalid JSON in trace file ${file}: ${e}` })
      })
      const trace = yield* Effect.mapError(
        Schema.decodeUnknownEffect(ItfTrace)(json),
        (e) => new QuintError({ message: `Failed to parse ITF trace ${file}: ${e}` })
      )
      traces.push(trace)
    }
    return traces
  })

const generateTracesWithTraceDir = (
  opts: RunOptions,
  traceDir: string
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> =>
  Effect.gen(function*() {
    yield* Effect.tryPromise({
      try: () => mkdir(traceDir, { recursive: true }),
      catch: (e) => new QuintError({ message: `Failed to create trace directory: ${e}` })
    })
    return yield* runAndReadTraces(opts, traceDir)
  })

const generateTracesWithTempDir = (
  opts: RunOptions
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "quint-")),
      catch: (e) => new QuintError({ message: `Failed to create temp directory: ${e}` })
    }),
    (tmpDir) => runAndReadTraces(opts, tmpDir),
    (tmpDir) => Effect.promise(() => rm(tmpDir, { recursive: true, force: true }).catch(() => {}))
  )

export const generateTraces = (
  opts: RunOptions
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> =>
  opts.traceDir !== undefined
    ? generateTracesWithTraceDir(opts, opts.traceDir)
    : generateTracesWithTempDir(opts)
