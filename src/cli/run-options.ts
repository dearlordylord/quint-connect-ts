export interface QuintRunGeneration {
  readonly mode?: "run"
}

export interface QuintTestGeneration {
  readonly mode: "test"
  readonly test: string
}

export type TraceGenerationMode = QuintRunGeneration | QuintTestGeneration

export interface RunOptions {
  readonly spec: string
  /** Defaults to `quint run`; use test mode to replay one named Quint test exactly. */
  readonly generation?: TraceGenerationMode | undefined
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

export const isQuintTestGeneration = (
  opts: RunOptions
): opts is RunOptions & { readonly generation: QuintTestGeneration } => opts.generation?.mode === "test"

export const DEFAULT_N_TRACES = 10
export const DEFAULT_MAX_SAMPLES = 10000
export const DEFAULT_MAX_STEPS = 10
