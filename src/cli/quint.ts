import * as Command from "@effect/platform/Command"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, Schema, Stream } from "effect"
import { ItfTrace } from "../itf/schema.js"

export class QuintError extends Schema.TaggedError<QuintError>()("QuintError", {
  message: Schema.String,
  stderr: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number)
}) {}

export class QuintNotFoundError extends Schema.TaggedError<QuintNotFoundError>()("QuintNotFoundError", {
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
}

const DEFAULT_N_TRACES = 100

const buildRunArgs = (
  opts: RunOptions,
  outDir: string
): Array<string> => {
  const nTraces = opts.nTraces ?? DEFAULT_N_TRACES
  const args: Array<string> = [
    "run",
    opts.spec,
    "--mbt",
    "--backend",
    opts.backend ?? "typescript",
    "--n-traces",
    String(nTraces),
    "--out-itf",
    `${outDir}/trace_{seq}.itf.json`
  ]
  if (opts.seed !== undefined) {
    args.push("--seed", opts.seed)
  }
  if (opts.maxSteps !== undefined) {
    args.push("--max-steps", String(opts.maxSteps))
  }
  if (opts.maxSamples !== undefined) {
    args.push("--max-samples", String(opts.maxSamples))
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

export const generateTraces = (
  opts: RunOptions
): Effect.Effect<
  ReadonlyArray<ItfTrace>,
  QuintError | QuintNotFoundError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const tmpDir = yield* Effect.mapError(
      fs.makeTempDirectoryScoped(),
      (e) => new QuintError({ message: `Failed to create temp directory: ${e}` })
    )
    const args = buildRunArgs(opts, tmpDir)
    const cmd = Command.make("npx", "@informalsystems/quint", ...args)
    const proc = yield* Effect.mapError(
      Command.start(cmd),
      (e) => new QuintNotFoundError({ message: `Failed to start quint: ${e}` })
    )
    const decoder = new TextDecoder()
    const [exitCode, , stderr] = yield* Effect.mapError(
      Effect.all([
        proc.exitCode,
        Stream.runDrain(proc.stdout),
        Stream.runFold(proc.stderr, "", (acc, chunk) => acc + decoder.decode(chunk))
      ], { concurrency: "unbounded" }),
      (e) => new QuintError({ message: `quint process error: ${e}` })
    )
    if (exitCode !== 0) {
      return yield* new QuintError({
        message: `quint run failed with exit code ${exitCode}`,
        stderr,
        exitCode
      })
    }
    const files = yield* Effect.mapError(
      fs.readDirectory(tmpDir),
      (e) => new QuintError({ message: `Failed to read trace directory: ${e}` })
    )
    const traceFiles = files
      .filter((f: string) => f.endsWith(".itf.json"))
      .sort()
    const traces: Array<ItfTrace> = []
    for (const file of traceFiles) {
      const content = yield* Effect.mapError(
        fs.readFileString(path.join(tmpDir, file)),
        (e) => new QuintError({ message: `Failed to read trace file ${file}: ${e}` })
      )
      const json: unknown = yield* Effect.try({
        try: () => JSON.parse(content),
        catch: (e) => new QuintError({ message: `Invalid JSON in trace file ${file}: ${e}` })
      })
      const trace = yield* Effect.mapError(
        Schema.decodeUnknown(ItfTrace)(json),
        (e) => new QuintError({ message: `Failed to parse ITF trace ${file}: ${e}` })
      )
      traces.push(trace)
    }
    return traces
  }).pipe(Effect.scoped)
