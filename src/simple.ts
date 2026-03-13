import { NodeServices } from "@effect/platform-node"
import { Cause, Effect, Exit, Option, Result, Schema } from "effect"

import { transformITFValue } from "@firfi/itf-trace-parser"
import type { StandardSchemaV1 } from "@standard-schema/spec"

import type { RunOptions } from "./cli/quint.js"
import type { ActionMap, AnyActionDef, Config, Driver } from "./driver/types.js"
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
  readonly onInit?: (rawState: unknown) => void | Promise<void>
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
      onInit?: (rawState: unknown) => void | Promise<void>
    }
): () => SimpleDriver<State>
// Overload 2: raw mode — defineDriver(factory)
export function defineDriver<State = unknown>(
  factory: () => {
    step: (action: string, nondetPicks: ReadonlyMap<string, unknown>) => void | Promise<void>
    getState?: () => State
    config?: () => Config
    onInit?: (rawState: unknown) => void | Promise<void>
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
        ...(result.config ? { config: result.config } : {}),
        ...(result.onInit ? { onInit: result.onInit } : {})
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
      ...(result.config ? { config: result.config } : {}),
      ...(result.onInit ? { onInit: result.onInit } : {})
    }
  }
}

const wrapAction = (
  actionDef: AnySimpleActionDef
): AnyActionDef => {
  const fields: Record<string, Schema.Schema<unknown>> = {}
  for (const key of Object.keys(actionDef.picks)) {
    fields[key] = Schema.Unknown
  }

  return {
    picks: Schema.Struct(fields),
    handler: (rawPicks) =>
      Effect.promise(async () => {
        const decoded: Record<string, unknown> = {}
        for (const [key, schema] of Object.entries(actionDef.picks)) {
          const raw = rawPicks[key]
          const transformed = raw === undefined ? undefined : transformITFValue(raw)
          const result = schema["~standard"].validate(transformed)
          const resolved = result instanceof Promise ? await result : result
          if (resolved.issues) {
            throw new Error(
              `Pick "${key}" validation failed: ${resolved.issues.map((i) => i.message).join(", ")}`
            )
          }
          decoded[key] = resolved.value
        }
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
  const simpleOnInit = simple.onInit
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
      : {}),
    ...(simpleOnInit !== undefined
      ? {
        onInit: (rawState: unknown) =>
          Effect.promise(async () => {
            await Promise.resolve(simpleOnInit(rawState))
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

  return Effect.runPromiseExit(
    program.pipe(Effect.provide(NodeServices.layer))
  ).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value
    const failure = Cause.findErrorOption(exit.cause)
    if (Option.isSome(failure)) throw failure.value
    const defect = Cause.findDefect(exit.cause)
    if (Result.isSuccess(defect)) throw defect.success
    throw new Error("Unknown error in quint-connect run()")
  })
}

export const pickFrom = <T>(
  nondetPicks: ReadonlyMap<string, unknown>,
  key: string,
  schema: StandardSchemaV1<unknown, T>
): T | undefined => {
  const raw = nondetPicks.get(key)
  if (raw === undefined) return undefined
  // Unwrap Quint Option: { tag: "Some", value: x } | { tag: "None", ... }
  if (typeof raw !== "object" || raw === null || !("tag" in raw)) {
    throw new Error(`pickFrom "${key}": expected Quint Option (Some/None), got: ${JSON.stringify(raw)}`)
  }
  const variant = raw as { tag: string; value?: unknown }
  if (variant.tag === "None") return undefined
  if (variant.tag !== "Some") {
    throw new Error(`pickFrom "${key}": expected Option tag "Some" or "None", got: "${variant.tag}"`)
  }
  const transformed = transformITFValue(variant.value)
  const result = schema["~standard"].validate(transformed)
  if (result instanceof Promise) {
    throw new Error("pickFrom does not support async schemas")
  }
  if (result.issues) {
    throw new Error(
      `pickFrom "${key}" validation failed: ${result.issues.map((i) => i.message).join(", ")}`
    )
  }
  return result.value
}

export { transformITFValue } from "@firfi/itf-trace-parser"
