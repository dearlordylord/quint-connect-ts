import { Effect, Predicate, Schema } from "effect"

import type { ActionMap, AnyActionDef, Config } from "../driver/types.js"
import { buildEffectPicksDecoder } from "../itf/picks.js"
import type { MbtMeta } from "../itf/schema.js"
import { MbtMeta as MbtMetaSchema } from "../itf/schema.js"
import type { ReplayStepContext, TraceReplayError } from "./replay-errors.js"
import { actionContext, traceReplayError } from "./replay-errors.js"
import type { TraceStateRecord } from "./trace-state.js"
import { resolveNestedValue, stripMetadata } from "./trace-state.js"

export interface ReplayStep {
  readonly action: string
  readonly nondetPicks: ReadonlyMap<string, unknown>
  readonly specState: unknown
}

type ReplayAction = Omit<ReplayStep, "specState">

const extractMbtMeta = (
  state: TraceStateRecord,
  context: ReplayStepContext
): Effect.Effect<MbtMeta, TraceReplayError> =>
  Effect.mapError(
    Schema.decodeUnknown(MbtMetaSchema)(state),
    (cause) => traceReplayError(actionContext(context, "unknown"), `Failed to extract MBT metadata: ${cause}`)
  )

const isItfOption = (value: unknown): boolean =>
  Predicate.isRecord(value) && (value["tag"] === "Some" || value["tag"] === "None")

const normalizeNondetPathPick = (value: unknown): unknown => isItfOption(value) ? value : { tag: "Some", value }

const normalizeNondetPathPicks = (value: unknown): ReadonlyMap<string, unknown> =>
  Predicate.isRecord(value)
    ? new Map(Object.entries(value).map(([key, pick]) => [key, normalizeNondetPathPick(pick)]))
    : new Map<string, unknown>()

const extractFromNondetPath = (
  state: TraceStateRecord,
  nondetPath: ReadonlyArray<string>,
  context: ReplayStepContext
): Effect.Effect<ReplayAction, TraceReplayError> => {
  const raw = resolveNestedValue(state, nondetPath)
  if (!Predicate.isRecord(raw) || typeof raw["tag"] !== "string") {
    return Effect.fail(
      traceReplayError(
        actionContext(context, "unknown"),
        `Expected sum type {tag, value} at path ${nondetPath.join(".")}, got: ${JSON.stringify(raw)}`
      )
    )
  }
  const action = raw["tag"]
  const value = raw["value"]
  return Effect.succeed({ action, nondetPicks: normalizeNondetPathPicks(value) })
}

export const extractReplayAction = (
  state: TraceStateRecord,
  nondetPath: ReadonlyArray<string>,
  context: ReplayStepContext
): Effect.Effect<ReplayAction, TraceReplayError> =>
  nondetPath.length > 0
    ? extractFromNondetPath(state, nondetPath, context)
    : Effect.map(extractMbtMeta(state, context), (meta) => ({
      action: meta["mbt::actionTaken"],
      nondetPicks: new Map(Object.entries(meta["mbt::nondetPicks"]))
    }))

const projectSpecState = (
  state: TraceStateRecord,
  statePath: ReadonlyArray<string>,
  action: string,
  context: ReplayStepContext
): Effect.Effect<unknown, TraceReplayError> => {
  if (statePath.length === 0) {
    return Effect.succeed(stripMetadata(state))
  }

  const projected = resolveNestedValue(state, statePath)
  return projected === undefined
    ? Effect.fail(
      traceReplayError(
        actionContext(context, action),
        `Expected state at path ${statePath.join(".")}, got: undefined`
      )
    )
    : Effect.succeed(projected)
}

/** Decode all data needed to dispatch and check one trace state. */
export const decodeReplayStep = (
  state: TraceStateRecord,
  config: Config,
  context: ReplayStepContext
): Effect.Effect<ReplayStep, TraceReplayError> =>
  Effect.gen(function*() {
    const replayAction = yield* extractReplayAction(state, config.nondetPath ?? [], context)
    const specState = replayAction.action !== ""
      ? yield* projectSpecState(state, config.statePath ?? [], replayAction.action, context)
      : undefined
    return { ...replayAction, specState }
  })

export const buildPicksDecoder = buildEffectPicksDecoder<AnyActionDef["picks"]["fields"]>

export type PicksDecoder = ReturnType<typeof buildPicksDecoder>

export const buildPicksDecoders = <E, R>(
  actions: ActionMap<E, R>
): ReadonlyMap<string, PicksDecoder> =>
  new Map(
    Object.entries(actions)
      .filter((entry): entry is [string, AnyActionDef<E, R>] => entry[1] !== undefined)
      .map(([name, def]) => [name, buildPicksDecoder(def.picks)])
  )
