import { Effect, Predicate, Schema } from "effect"

import type { AnyActionDef, PartialActionMap } from "../driver/types.js"
import type { MbtMeta } from "../itf/schema.js"
import { ItfOption, MbtMeta as MbtMetaSchema } from "../itf/schema.js"
import type { ReplayStepContext, TraceReplayError } from "./replay-errors.js"
import { actionContext, traceReplayError } from "./replay-errors.js"
import type { TraceStateRecord } from "./trace-state.js"
import { resolveNestedValue } from "./trace-state.js"

interface ReplayAction {
  readonly action: string
  readonly nondetPicks: ReadonlyMap<string, unknown>
}

const extractMbtMeta = (
  state: TraceStateRecord,
  context: ReplayStepContext
): Effect.Effect<MbtMeta, TraceReplayError> =>
  Effect.mapError(
    Schema.decodeUnknown(MbtMetaSchema)(state),
    (cause) => traceReplayError(actionContext(context, "unknown"), `Failed to extract MBT metadata: ${cause}`)
  )

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
  const picks = Predicate.isRecord(value) ? new Map(Object.entries(value)) : new Map<string, unknown>()
  return Effect.succeed({ action, nondetPicks: picks })
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

export const buildPicksDecoder = (picksShape: AnyActionDef["picks"]) => {
  const wrappedFields = Object.fromEntries(
    Object.entries(picksShape.fields).map(([key, fieldSchema]) => [
      key,
      Schema.UndefinedOr(ItfOption(Schema.asSchema(fieldSchema)))
    ])
  )
  return Schema.decodeUnknown(Schema.Struct(wrappedFields))
}

export type PicksDecoder = ReturnType<typeof buildPicksDecoder>

export const buildPicksDecoders = <E, R>(
  actions: PartialActionMap<E, R>
): ReadonlyMap<string, PicksDecoder> =>
  new Map(
    Object.entries(actions)
      .filter((entry): entry is [string, AnyActionDef<E, R>] => entry[1] !== undefined)
      .map(([name, def]) => [name, buildPicksDecoder(def.picks)])
  )
