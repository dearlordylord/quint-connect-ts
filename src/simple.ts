import { Cause, Effect, Exit, Option, Schema } from "effect"

import { transformITFValue } from "@firfi/itf-trace-parser"
import type { StandardSchemaV1 } from "@standard-schema/spec"

import type { RunOptions } from "./cli/quint.js"
import type { ActionMap, AnyActionDef, Config, Driver } from "./driver/types.js"
import { decodeStandardPicks } from "./itf/picks.js"
import { quintRun } from "./runner/runner.js"

export type { RunOptions } from "./cli/quint.js"
export type { Config } from "./driver/types.js"
export { defaultConfig } from "./driver/types.js"

export { QuintError, QuintNotFoundError } from "./cli/quint.js"
export { NoTracesError, StateMismatchError, TraceReplayError } from "./runner/runner.js"

// Per-field schemas for one action's picks
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PicksSchema = Record<string, StandardSchemaV1<any, any>>

// Handler receives each field's output type (use schema's .optional() for | undefined)
type HandlerPicks<Fields extends PicksSchema> = {
  readonly [K in keyof Fields]: StandardSchemaV1.InferOutput<Fields[K]>
}

interface AnySimpleActionDefPicks {
  readonly picks: PicksSchema
}

interface AnySimpleActionDefHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly handler: (picks: any) => void | Promise<void>
}

type AnySimpleActionDef = AnySimpleActionDefPicks & AnySimpleActionDefHandler

export interface SimpleActionMap {
  readonly [action: string]: AnySimpleActionDef
}

interface SimpleDriverActions<Actions extends SimpleActionMap> {
  readonly actions: Actions
}

interface SimpleDriverHooks<S> {
  readonly getState?: () => S
  readonly config?: () => Config
  readonly step?: (action: string, nondetPicks: ReadonlyMap<string, unknown>) => void | Promise<void>
}

export type SimpleDriver<S, Actions extends SimpleActionMap = SimpleActionMap> =
  & SimpleDriverActions<Actions>
  & SimpleDriverHooks<S>

interface SimpleRunStateCheck<S> {
  readonly compareState: (spec: S, impl: S) => boolean
  readonly deserializeState: (raw: unknown) => S
}

export const stateCheck = <S>(
  deserializeState: (raw: unknown) => S,
  compareState: (spec: S, impl: S) => boolean
): SimpleRunStateCheck<S> => ({ compareState, deserializeState })

interface SimpleRunDriver<S, Actions extends SimpleActionMap> {
  readonly driver: () => SimpleDriver<S, Actions> | Promise<SimpleDriver<S, Actions>>
}

interface SimpleRunOptionsExtra<S> {
  readonly stateCheck?: SimpleRunStateCheck<S> | undefined
  readonly concurrency?: number | undefined
}

export type SimpleRunOptions<S, Actions extends SimpleActionMap = SimpleActionMap> =
  & RunOptions
  & SimpleRunDriver<S, Actions>
  & SimpleRunOptionsExtra<S>

// Overload 1: typed mode — defineDriver(schema, factory)
export function defineDriver<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  S extends Record<string, Record<string, StandardSchemaV1<any, any>>>,
  State = unknown
>(
  schema: S,
  factory: () =>
    & { [K in keyof S]: (picks: HandlerPicks<S[K]>) => void | Promise<void> }
    & {
      getState?: () => State
      config?: () => Config
    }
): () => SimpleDriver<State>
// Overload 2: raw mode — defineDriver(factory)
export function defineDriver<State = unknown>(
  factory: () => {
    step: (action: string, nondetPicks: ReadonlyMap<string, unknown>) => void | Promise<void>
    getState?: () => State
    config?: () => Config
  }
): () => SimpleDriver<State>
// Implementation
export function defineDriver(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schemaOrFactory: Record<string, Record<string, StandardSchemaV1<any, any>>> | (() => any),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  maybeFactory?: () => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): () => SimpleDriver<any> {
  if (typeof schemaOrFactory === "function") {
    // Raw mode
    const factory = schemaOrFactory
    return () => {
      const result = factory()
      return {
        actions: {},
        step: result.step,
        ...(result.getState ? { getState: result.getState } : {}),
        ...(result.config ? { config: result.config } : {})
      }
    }
  }
  // Typed mode
  const schema = schemaOrFactory
  const factory = maybeFactory!
  return () => {
    const result = factory()
    const actions: Record<string, AnySimpleActionDef> = {}
    for (const name of Object.keys(schema)) {
      actions[name] = { picks: schema[name], handler: result[name] }
    }
    return {
      actions,
      ...(result.getState ? { getState: result.getState } : {}),
      ...(result.config ? { config: result.config } : {})
    }
  }
}

const wrapAction = (
  actionDef: AnySimpleActionDef
): AnyActionDef => {
  const fields: Record<string, Schema.Schema<unknown, unknown, never>> = {}
  for (const key of Object.keys(actionDef.picks)) {
    fields[key] = Schema.Unknown
  }

  return {
    picks: Schema.Struct(fields),
    handler: (rawPicks) =>
      Effect.promise(async () => {
        const decoded = await decodeStandardPicks(rawPicks, actionDef.picks)
        await Promise.resolve(actionDef.handler(decoded))
      })
  }
}

const wrapDriver = <S, Actions extends SimpleActionMap>(
  simple: SimpleDriver<S, Actions>
): Driver<S, never, never, ActionMap> => {
  const actions: Record<string, AnyActionDef> = {}
  for (const [action, def] of Object.entries(simple.actions)) {
    actions[action] = wrapAction(def)
  }

  const simpleGetState = simple.getState
  const simpleStep = simple.step
  return {
    actions,
    ...(simpleGetState !== undefined ? { getState: () => Effect.sync(simpleGetState) } : {}),
    ...(simple.config !== undefined ? { config: simple.config } : {}),
    ...(simpleStep !== undefined
      ? {
        step: (action: string, picks: ReadonlyMap<string, unknown>) =>
          Effect.promise(async () => {
            await Promise.resolve(simpleStep(action, picks))
          })
      }
      : {})
  }
}

export const run = <S, Actions extends SimpleActionMap>(
  opts: SimpleRunOptions<S, Actions>
): Promise<{ readonly tracesReplayed: number; readonly seed: string }> => {
  const { driver, stateCheck: sc, ...runOpts } = opts
  const program = quintRun({
    ...runOpts,
    driverFactory: {
      create: () => Effect.promise(async () => wrapDriver(await Promise.resolve(driver())))
    },
    stateCheck: sc !== undefined
      ? {
        compareState: sc.compareState,
        deserializeState: (raw: unknown) => Effect.sync(() => sc.deserializeState(transformITFValue(raw)))
      }
      : undefined
  })

  return Effect.runPromiseExit(program).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value
    const failure = Cause.failureOption(exit.cause)
    if (Option.isSome(failure)) throw failure.value
    const defect = Cause.dieOption(exit.cause)
    if (Option.isSome(defect)) throw defect.value
    throw new Error("Unknown error in quint-connect run()")
  })
}

export { transformITFValue } from "@firfi/itf-trace-parser"
export { pickFrom } from "./itf/picks.js"
