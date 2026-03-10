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
  PartialActionMap,
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
type EffectPicksSchema = Record<string, Schema.Schema<any, any, never>>

type EffectHandlerPicks<Fields extends EffectPicksSchema> = {
  readonly [K in keyof Fields]: Schema.Schema.Type<Fields[K]>
}

export const defineDriver = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  S extends Record<string, Record<string, Schema.Schema<any, any, never>>>,
  State = unknown,
  E = never,
  R = never
>(
  schema: S,
  factory: () =>
    & { [K in keyof S]: (picks: EffectHandlerPicks<S[K]>) => Effect.Effect<void, E, R> }
    & {
      getState?: () => Effect.Effect<State, E, R>
      config?: () => Config
    }
): DriverFactory<State, E, R> => ({
  create: () =>
    Effect.sync(() => {
      const result = factory()
      const actions: Record<string, AnyActionDef<E, R>> = {}
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
})
