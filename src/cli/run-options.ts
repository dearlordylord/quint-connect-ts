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
  readonly verbose?: boolean | undefined
  readonly traceDir?: string | undefined
}

export interface RunGenerationOptions extends CommonGenerationOptions {
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

export type RunOptions = RunGenerationOptions | TestGenerationOptions

export const isQuintTestGeneration = (opts: RunOptions): opts is TestGenerationOptions =>
  opts.generation?.mode === "test"

export const isQuintRunGeneration = (opts: RunOptions): opts is RunGenerationOptions => !isQuintTestGeneration(opts)

export const DEFAULT_N_TRACES = 10
export const DEFAULT_TEST_MAX_SAMPLES = 10
export const DEFAULT_MAX_SAMPLES = 10000
export const DEFAULT_MAX_STEPS = 10
