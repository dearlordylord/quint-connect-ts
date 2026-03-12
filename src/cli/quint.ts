import { Effect, FileSystem, Path, Schema, Stream } from "effect"
import type { Scope } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
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

const runAndReadTraces = (
  opts: RunOptions,
  outDir: string
): Effect.Effect<
  ReadonlyArray<ItfTrace>,
  QuintError | QuintNotFoundError,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const args = buildRunArgs(opts, outDir)
    const cmd = ChildProcess.make(
      "npx",
      ["@informalsystems/quint", ...args],
      opts.verbose === true ? { env: { QUINT_VERBOSE: "true" }, extendEnv: true } : undefined
    )
    const proc = yield* Effect.mapError(
      Effect.fromYieldable(cmd),
      (e) => new QuintNotFoundError({ message: `Failed to start quint: ${e}` })
    )
    const decoder = new TextDecoder()
    const [exitCode, , stderr] = yield* Effect.mapError(
      Effect.all([
        proc.exitCode,
        Stream.runDrain(proc.stdout),
        Stream.runFold(proc.stderr, () => "", (acc, chunk) => acc + decoder.decode(chunk))
      ], { concurrency: "unbounded" }),
      (e) => new QuintError({ message: `quint process error: ${e}` })
    )
    if (exitCode !== 0) {
      return yield* new QuintError({
        message: stderr
          ? `quint run failed with exit code ${exitCode}:\n${stderr.trim()}`
          : `quint run failed with exit code ${exitCode}`,
        stderr,
        exitCode
      })
    }
    const files = yield* Effect.mapError(
      fs.readDirectory(outDir),
      (e) => new QuintError({ message: `Failed to read trace directory: ${e}` })
    )
    const traceFiles = files
      .filter((f: string) => f.endsWith(".itf.json"))
      .sort()
    const traces: Array<ItfTrace> = []
    for (const file of traceFiles) {
      const content = yield* Effect.mapError(
        fs.readFileString(path.join(outDir, file)),
        (e) => new QuintError({ message: `Failed to read trace file ${file}: ${e}` })
      )
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
): Effect.Effect<
  ReadonlyArray<ItfTrace>,
  QuintError | QuintNotFoundError,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    yield* Effect.mapError(
      fs.makeDirectory(traceDir, { recursive: true }),
      (e) => new QuintError({ message: `Failed to create trace directory: ${e}` })
    )
    return yield* runAndReadTraces(opts, traceDir)
  }).pipe(Effect.scoped)

const generateTracesWithTempDir = (
  opts: RunOptions
): Effect.Effect<
  ReadonlyArray<ItfTrace>,
  QuintError | QuintNotFoundError,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const tmpDir = yield* Effect.mapError(
      fs.makeTempDirectoryScoped(),
      (e) => new QuintError({ message: `Failed to create temp directory: ${e}` })
    )
    return yield* runAndReadTraces(opts, tmpDir)
  }).pipe(Effect.scoped)

export const generateTraces = (
  opts: RunOptions
): Effect.Effect<
  ReadonlyArray<ItfTrace>,
  QuintError | QuintNotFoundError,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner
> =>
  opts.traceDir !== undefined
    ? generateTracesWithTraceDir(opts, opts.traceDir)
    : generateTracesWithTempDir(opts)
