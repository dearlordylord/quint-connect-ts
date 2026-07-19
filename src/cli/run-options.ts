export interface QuintRunGeneration {
  readonly mode?: "run"
}

export interface QuintTestGeneration {
  readonly mode: "test"
  readonly test: string
}

export type TraceGenerationMode = QuintRunGeneration | QuintTestGeneration

interface CommonGenerationOptions {
  readonly spec: string
  readonly seed?: string | undefined
  readonly main?: string | undefined
  readonly backend?: "typescript" | "rust" | undefined
  /** Exact Quint executable path or command. Takes precedence over QUINT_BIN and PATH lookup. */
  readonly quintBin?: string | undefined
  readonly verbose?: boolean | undefined
  readonly traceDir?: string | undefined
}

/** Backwards-compatible options for quint run generation. */
export interface RunOptions extends CommonGenerationOptions {
  readonly generation?: QuintRunGeneration | undefined
  readonly nTraces?: number | undefined
  readonly maxSteps?: number | undefined
  readonly maxSamples?: number | undefined
  readonly init?: string | undefined
  readonly step?: string | undefined
  readonly invariants?: ReadonlyArray<string> | undefined
  readonly witnesses?: ReadonlyArray<string> | undefined
  /**
   * Path to a pre-compiled evaluator input JSON file (produced by `quint-connect-compile`).
   * When provided and the file exists, skips `quint run` entirely and calls the Rust
   * evaluator directly. The file contains the parsed spec + resolver table, so the 15s+
   * parse/typecheck overhead is eliminated on repeat runs.
   *
   * The runtime parameters (maxSamples, maxSteps, nTraces, seed) are patched into the
   * cached input before sending to the evaluator.
   */
  readonly compiledInput?: string | undefined
}

export type RunGenerationOptions = RunOptions

export interface TestGenerationOptions extends CommonGenerationOptions {
  readonly generation: QuintTestGeneration
  /** Number of successful randomized executions requested from `quint test`. */
  readonly maxSamples?: number | undefined
  readonly nTraces?: never
  readonly maxSteps?: never
  readonly init?: never
  readonly step?: never
  readonly invariants?: never
  readonly witnesses?: never
  readonly compiledInput?: never
}

/** Mode-safe generation options accepted by public generation and replay entrypoints. */
export type TraceGenerationOptions = RunOptions | TestGenerationOptions

/** Canonical discriminator used by type guards and trace-generation policy. */
const resolveTraceGenerationMode = (opts: TraceGenerationOptions): "run" | "test" => opts.generation?.mode ?? "run"

export const isQuintTestGeneration = (opts: TraceGenerationOptions): opts is TestGenerationOptions =>
  resolveTraceGenerationMode(opts) === "test"

export const DEFAULT_N_TRACES = 10
export const DEFAULT_TEST_MAX_SAMPLES = 10
export const DEFAULT_MAX_SAMPLES = 10000
export const DEFAULT_MAX_STEPS = 10
