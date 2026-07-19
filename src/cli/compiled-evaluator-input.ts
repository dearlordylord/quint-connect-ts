import { Effect, Schema, SchemaGetter } from "effect"

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

const RuntimeFields = Schema.Struct({
  nruns: Schema.optional(Schema.Number),
  nsteps: Schema.optional(Schema.Number),
  ntraces: Schema.optional(Schema.Number),
  nthreads: Schema.optional(Schema.Number)
})

const CompiledEvaluatorInputValue = Schema.Struct({
  source: Schema.String,
  runtime: RuntimeFields
})

const runtimeInteger = (source: string, pattern: RegExp): number | undefined => {
  const value = pattern.exec(source)?.[1]
  return value === undefined ? undefined : Number(value)
}

const CompiledEvaluatorInput = Schema.String.pipe(
  Schema.decodeTo(
    Schema.toType(CompiledEvaluatorInputValue),
    {
      decode: SchemaGetter.transform((source) => ({
        source,
        runtime: {
          nruns: runtimeInteger(source, /"nruns":\s*(\d+)/),
          nsteps: runtimeInteger(source, /"nsteps":\s*(\d+)/),
          ntraces: runtimeInteger(source, /"ntraces":\s*(\d+)/),
          nthreads: runtimeInteger(source, /"nthreads":\s*(\d+)/)
        }
      })),
      encode: SchemaGetter.transform((input) => input.source)
    }
  )
)

type CompiledEvaluatorInput = typeof CompiledEvaluatorInput.Type

export const decodeCompiledEvaluatorInput = (
  input: unknown
): Effect.Effect<CompiledEvaluatorInput, QuintError> =>
  Schema.decodeUnknownEffect(CompiledEvaluatorInput)(input).pipe(
    Effect.mapError((error) => new QuintError({ message: `Invalid compiled evaluator input: ${error}` }))
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
