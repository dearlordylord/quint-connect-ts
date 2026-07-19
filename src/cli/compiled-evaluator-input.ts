import { Effect, Schema } from "effect"

import { QuintError } from "./errors.js"
import type { RunOptions } from "./run-options.js"
import { DEFAULT_MAX_SAMPLES, DEFAULT_MAX_STEPS, DEFAULT_N_TRACES } from "./run-options.js"

const RANDOM_SEED_HEX_LENGTH = 16
const HEX_RADIX = 16
const MIN_EVALUATOR_THREADS = 2

interface PatchedCompiledInput {
  readonly input: string
  readonly seedHex: string
}

interface CompiledEvaluatorInput {
  readonly source: string
  readonly runtime: {
    readonly nruns?: number | undefined
    readonly nsteps?: number | undefined
    readonly ntraces?: number | undefined
    readonly nthreads?: number | undefined
  }
}

const CompiledEvaluatorRuntime = Schema.Struct({
  nruns: Schema.optional(Schema.Number),
  nsteps: Schema.optional(Schema.Number),
  ntraces: Schema.optional(Schema.Number),
  nthreads: Schema.optional(Schema.Number)
})

export const decodeCompiledEvaluatorInput = (
  input: unknown
): Effect.Effect<CompiledEvaluatorInput, QuintError> =>
  Schema.decodeUnknown(Schema.String)(input).pipe(
    Effect.mapError((error) => new QuintError({ message: `Invalid compiled evaluator input: ${error}` })),
    Effect.flatMap((source) =>
      source.trimStart().startsWith("{")
        ? Schema.decodeUnknown(Schema.parseJson(CompiledEvaluatorRuntime))(source).pipe(
          Effect.mapError((error) => new QuintError({ message: `Invalid compiled evaluator input: ${error}` })),
          Effect.map((runtime) => ({ source, runtime }))
        )
        : Effect.succeed({ source, runtime: {} })
    )
  )

const parseSeed: (seed: string) => bigint = BigInt

export const makeRandomSeedHex = (): string =>
  Array.from(
    { length: RANDOM_SEED_HEX_LENGTH },
    () => Math.floor(Math.random() * HEX_RADIX).toString(HEX_RADIX)
  ).join("")

export const patchCompiledEvaluatorInput = (
  compiledInput: CompiledEvaluatorInput,
  opts: RunOptions,
  cpuCount: number,
  randomSeedHex: string
): PatchedCompiledInput => {
  const nTraces = opts.nTraces ?? DEFAULT_N_TRACES
  const maxSamples = opts.maxSamples ?? DEFAULT_MAX_SAMPLES
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
  const nThreads = Math.max(MIN_EVALUATOR_THREADS, Math.min(maxSamples, cpuCount))

  let patchedInput = compiledInput.source
  if (compiledInput.runtime.nruns !== undefined) {
    patchedInput = patchedInput.replace(/"nruns":\s*\d+/, `"nruns":${maxSamples}`)
  }
  if (compiledInput.runtime.nsteps !== undefined) {
    patchedInput = patchedInput.replace(/"nsteps":\s*\d+/, `"nsteps":${maxSteps}`)
  }
  if (compiledInput.runtime.ntraces !== undefined) {
    patchedInput = patchedInput.replace(/"ntraces":\s*\d+/, `"ntraces":${nTraces}`)
  }
  if (compiledInput.runtime.nthreads !== undefined) {
    patchedInput = patchedInput.replace(/"nthreads":\s*\d+/, `"nthreads":${nThreads}`)
  }

  const seedBigint = opts.seed !== undefined ? parseSeed(opts.seed) : BigInt(`0x${randomSeedHex}`)
  const seedHex = `0x${seedBigint.toString(HEX_RADIX)}`
  const seedReplaced = patchedInput.replace(/"seed":\s*(?:null|undefined|\d+)/, `"seed":${seedBigint}`)
  patchedInput = seedReplaced === patchedInput
    ? patchedInput.replace(/}\s*$/, `,"seed":${seedBigint}}`)
    : seedReplaced

  return { input: patchedInput, seedHex }
}
