import { Config, Effect } from "effect"

import { QuintError } from "./errors.js"
import type { RunGenerationOptions, TestGenerationOptions, TraceGenerationOptions } from "./run-options.js"
import {
  DEFAULT_MAX_SAMPLES,
  DEFAULT_N_TRACES,
  DEFAULT_TEST_MAX_SAMPLES,
  isQuintTestGeneration
} from "./run-options.js"

// eslint-disable-next-line functional/no-mixed-types -- resolved policy combines decisions with argument construction.
interface RunTraceGenerationPolicy {
  readonly mode: "run"
  readonly command: "quint run"
  readonly options: RunGenerationOptions
  readonly buildCliArgs: (outDir: string) => Effect.Effect<ReadonlyArray<string>, QuintError>
}

// eslint-disable-next-line functional/no-mixed-types -- resolved policy combines decisions with argument construction.
interface TestTraceGenerationPolicy {
  readonly mode: "test"
  readonly command: "quint test"
  readonly options: TestGenerationOptions
  readonly buildCliArgs: (outDir: string) => Effect.Effect<ReadonlyArray<string>, QuintError>
}

type TraceGenerationPolicy = RunTraceGenerationPolicy | TestTraceGenerationPolicy

type CompiledRunOptions = RunGenerationOptions & { readonly compiledInput: string }

type CompiledEvaluatorPolicy = RunTraceGenerationPolicy & {
  readonly options: CompiledRunOptions
}

const BackendEnvironment = Config.literals(["typescript", "rust"], "QUINT_BACKEND").pipe(
  Config.withDefault("typescript")
)

const resolveBackend = (
  opts: TraceGenerationOptions
): Effect.Effect<"typescript" | "rust", QuintError> =>
  opts.backend !== undefined
    ? Effect.succeed(opts.backend)
    : BackendEnvironment.pipe(
      Effect.mapError((error) =>
        new QuintError({ message: `Invalid QUINT_BACKEND: expected "typescript" or "rust": ${error}` })
      )
    )

export const validateTraceGenerationConfiguration = (
  opts: TraceGenerationOptions
): Effect.Effect<void, QuintError> => Effect.as(resolveBackend(opts), undefined)

const buildRunArgsWithBackend = (
  opts: RunGenerationOptions,
  outDir: string,
  backend: "typescript" | "rust"
): ReadonlyArray<string> => {
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
  if (opts.invariants !== undefined && opts.invariants.length > 0) {
    args.push("--invariants", ...opts.invariants)
  }
  if (opts.witnesses !== undefined && opts.witnesses.length > 0) {
    args.push("--witnesses", ...opts.witnesses)
  }
  return args
}

/** Backwards-compatible synchronous argument builder. Invalid environment config throws immediately. */
export const buildRunArgs = (
  opts: RunGenerationOptions,
  outDir: string
): ReadonlyArray<string> => buildRunArgsWithBackend(opts, outDir, Effect.runSync(resolveBackend(opts)))

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const buildTestArgsWithBackend = (
  opts: TestGenerationOptions,
  outDir: string,
  backend: "typescript" | "rust"
): ReadonlyArray<string> => {
  const maxSamples = opts.maxSamples ?? DEFAULT_TEST_MAX_SAMPLES
  const args: Array<string> = [
    "test",
    opts.spec,
    "--match",
    `^${escapeRegex(opts.generation.test)}$`,
    "--max-samples",
    String(maxSamples),
    "--out-itf",
    `${outDir}/trace_{seq}.itf.json`,
    "--verbosity",
    "0"
  ]
  args.push("--backend", backend)
  if (opts.seed !== undefined) {
    args.push("--seed", opts.seed)
  }
  if (opts.main !== undefined) {
    args.push("--main", opts.main)
  }
  return args
}

/** Backwards-compatible synchronous argument builder. Invalid environment config throws immediately. */
export const buildTestArgs = (
  opts: TestGenerationOptions,
  outDir: string
): ReadonlyArray<string> => buildTestArgsWithBackend(opts, outDir, Effect.runSync(resolveBackend(opts)))

export const resolveTraceGenerationPolicy = (
  opts: TraceGenerationOptions
): TraceGenerationPolicy => {
  if (isQuintTestGeneration(opts)) {
    return {
      mode: "test",
      command: "quint test",
      options: opts,
      buildCliArgs: (outDir) =>
        Effect.map(resolveBackend(opts), (backend) => buildTestArgsWithBackend(opts, outDir, backend))
    }
  }
  return {
    mode: "run",
    command: "quint run",
    options: opts,
    buildCliArgs: (outDir) =>
      Effect.map(resolveBackend(opts), (backend) => buildRunArgsWithBackend(opts, outDir, backend))
  }
}

export const isCompiledEvaluatorPolicy = (
  policy: TraceGenerationPolicy
): policy is CompiledEvaluatorPolicy => policy.mode === "run" && policy.options.compiledInput !== undefined
