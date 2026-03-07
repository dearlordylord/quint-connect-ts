import { NodeContext } from "@effect/platform-node"
import { Effect, Predicate, Schema } from "effect"

import type { RunOptions } from "./cli/quint.js"
import type { Config, Driver, Step } from "./driver/types.js"
import { ITFBigInt } from "./itf/schema.js"
import { quintRun } from "./runner/runner.js"

// Re-export framework-agnostic types
export type { RunOptions } from "./cli/quint.js"
export type { Config, Step } from "./driver/types.js"
export { defaultConfig } from "./driver/types.js"

// Re-export errors for instanceof checks
export { QuintError, QuintNotFoundError } from "./cli/quint.js"
export { NoTracesError, StateMismatchError, TraceReplayError } from "./runner/runner.js"

export type SimpleDriver<S> = {
  readonly step: (step: Step) => void | Promise<void>
  readonly getState: () => S
  readonly config?: () => Config
}

export type SimpleRunOptions<S> = RunOptions & {
  readonly createDriver: () => SimpleDriver<S> | Promise<SimpleDriver<S>>
  readonly stateCheck?: {
    readonly compareState: (spec: S, impl: S) => boolean
    readonly deserializeState: (raw: unknown) => S
  } | undefined
}

const wrapDriver = <S>(simple: SimpleDriver<S>): Driver<S> => ({
  step: (s: Step) =>
    Effect.promise(async () => {
      await Promise.resolve(simple.step(s))
    }),
  getState: () => Effect.sync(() => simple.getState()),
  ...(simple.config !== undefined ? { config: simple.config } : {})
})

export const run = <S>(
  opts: SimpleRunOptions<S>
): Promise<{ readonly tracesReplayed: number; readonly seed: string }> => {
  const program = quintRun({
    spec: opts.spec,
    seed: opts.seed,
    nTraces: opts.nTraces,
    maxSteps: opts.maxSteps,
    maxSamples: opts.maxSamples,
    init: opts.init,
    step: opts.step,
    main: opts.main,
    driverFactory: {
      create: () => Effect.promise(async () => wrapDriver(await Promise.resolve(opts.createDriver())))
    },
    stateCheck: opts.stateCheck !== undefined
      ? (() => {
        const { compareState, deserializeState } = opts.stateCheck
        return {
          compareState,
          deserializeState: (raw: unknown) => Effect.sync(() => deserializeState(raw))
        }
      })()
      : undefined
  })

  return Effect.runPromise(
    program.pipe(Effect.provide(NodeContext.layer))
  )
}

// --- Option unwrap helpers ---

const unwrapOption = (raw: unknown): unknown => {
  if (Predicate.isRecord(raw) && "tag" in raw) {
    if (raw["tag"] === "Some" && "value" in raw) {
      return raw["value"]
    }
    if (raw["tag"] === "None") {
      return undefined
    }
  }
  return raw
}

// --- pick: sync Option unwrap ---

export function pick(step: Step, key: string): unknown | undefined
export function pick<A>(step: Step, key: string, decode: (raw: unknown) => A): A | undefined
export function pick<A>(step: Step, key: string, decode?: (raw: unknown) => A): A | unknown | undefined {
  const raw = step.nondetPicks.get(key)
  if (raw === undefined) return undefined
  const value = unwrapOption(raw)
  if (value === undefined) return undefined
  return decode !== undefined ? decode(value) : value
}

// --- pickAll: sync batch Option unwrap ---

/**
 * Extract all nondet picks at once with a sync decoder.
 *
 * Converts the step's nondetPicks map to a plain object, unwrapping
 * Quint Option variants (Some -> inner value, None -> undefined),
 * then passes the result to the user's decode function.
 */
export const pickAll = <A>(
  step: Step,
  decode: (raw: Record<string, unknown>) => A
): A => {
  const unwrapped = Object.fromEntries(
    Array.from(step.nondetPicks, ([key, value]) => [key, unwrapOption(value)])
  )
  return decode(unwrapped)
}

// --- Sync ITF decoders (wrap Effect schemas) ---

export const decodeBigInt = (raw: unknown): bigint => Schema.decodeUnknownSync(ITFBigInt)(raw)

export const decodeSet = <A>(raw: unknown, decodeItem: (v: unknown) => A): ReadonlySet<A> => {
  const struct = Schema.decodeUnknownSync(
    Schema.Struct({ "#set": Schema.Array(Schema.Unknown) })
  )(raw)
  return new Set(struct["#set"].map(decodeItem))
}

export const decodeMap = <K, V>(
  raw: unknown,
  decodeKey: (v: unknown) => K,
  decodeValue: (v: unknown) => V
): ReadonlyMap<K, V> => {
  const struct = Schema.decodeUnknownSync(
    Schema.Struct({ "#map": Schema.Array(Schema.Tuple(Schema.Unknown, Schema.Unknown)) })
  )(raw)
  return new Map(struct["#map"].map(([k, v]) => [decodeKey(k), decodeValue(v)] as const))
}
