import { Effect, Schema } from "effect"

import type { AnyActionDef, Config, DriverFactory } from "./driver/types.js"
import type { StateCheck } from "./runner/runner.js"

export type {
  ActionDef,
  ActionMap,
  ActionPicks,
  Config,
  Driver,
  DriverFactory,
  StateComparator
} from "./driver/types.js"
export { defaultConfig } from "./driver/types.js"

export type { RunOptions } from "./cli/quint.js"
export { generateTraces, QuintError, QuintNotFoundError } from "./cli/quint.js"

export type { QuintRunOptions, StateCheck } from "./runner/runner.js"
export { NoTracesError, quintRun, StateMismatchError, TraceReplayError } from "./runner/runner.js"

export {
  ITFBigInt,
  ITFList,
  ITFMap,
  ItfOption,
  ITFSet,
  ItfTrace,
  ITFTuple,
  ITFUnserializable,
  ITFVariant,
  MbtMeta,
  UntypedTraceSchema
} from "./itf/schema.js"
export type { ITFValueRaw } from "./itf/schema.js"

export const stateCheck = <S>(
  deserializeState: (raw: unknown) => Effect.Effect<S>,
  compareState: (spec: S, impl: S) => boolean
): StateCheck<S> => ({ compareState, deserializeState })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EffectPicksSchema = Record<string, Schema.Schema<any>>

type EffectHandlerPicks<Fields extends EffectPicksSchema> = {
  readonly [K in keyof Fields]: Schema.Schema.Type<Fields[K]>
}

type EffectDriverFactoryResult<
  S extends Record<string, EffectPicksSchema>
> =
  & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [K in keyof S]: (picks: EffectHandlerPicks<S[K]>) => Effect.Effect<void, any, any>
  }
  & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getState?: () => Effect.Effect<any, any, any>
    config?: () => Config
  }

type FactoryState<F> = F extends {
  readonly getState: () => Effect.Effect<infer State, infer _Error, infer _Requirements>
} ? State
  : unknown

type FactoryError<F> = {
  [K in keyof F]: F[K] extends (...args: ReadonlyArray<never>) => Effect.Effect<unknown, infer E, unknown> ? E : never
}[keyof F]

type FactoryRequirements<F> = {
  [K in keyof F]: F[K] extends (...args: ReadonlyArray<never>) => Effect.Effect<unknown, unknown, infer R> ? R : never
}[keyof F]

export function defineDriver<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  S extends Record<string, Record<string, Schema.Schema<any>>>,
  Factory extends EffectDriverFactoryResult<S>
>(
  schema: S,
  factory: () => Factory
): DriverFactory<FactoryState<Factory>, FactoryError<Factory>, FactoryRequirements<Factory>>
// Implementation
export function defineDriver(
  schema: Record<string, EffectPicksSchema>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  factory: () => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): DriverFactory<any, any, any> {
  return {
    create: () =>
      Effect.sync(() => {
        const result = factory()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actions: Record<string, AnyActionDef<any, any>> = {}
        for (const [name, fields] of Object.entries(schema)) {
          actions[name] = {
            picks: Schema.Struct(fields),
            handler: result[name]
          }
        }
        return {
          actions,
          ...(result.getState ? { getState: result.getState } : {}),
          ...(result.config ? { config: result.config } : {})
        }
      })
  }
}
