import { Effect, Schema } from "effect"
import type { Step } from "../driver/types.js"
import { ItfOption } from "./schema.js"

export const pickFrom = <A, I, R>(
  step: Step,
  key: string,
  schema: Schema.Schema<A, I, R>
): Effect.Effect<A | undefined, never, R> => {
  const raw = step.nondetPicks.get(key)
  if (raw === undefined) return Effect.succeed(undefined)
  return Schema.decodeUnknown(ItfOption(schema))(raw).pipe(Effect.orDie)
}

type SchemaFields = { readonly [x: string]: Schema.Schema.All }

type PickAllResult<Fields extends SchemaFields> = {
  readonly [K in keyof Fields]: Schema.Schema.Type<Fields[K]> | undefined
}

type PickAllContext<Fields extends SchemaFields> = Schema.Schema.Context<Fields[keyof Fields]>

/**
 * Extract all nondet picks from a step at once, using a struct schema.
 *
 * Each field in the provided struct schema is automatically wrapped in ItfOption
 * to handle the Quint Some/None encoding. Missing keys yield `undefined`.
 *
 * @example
 * ```ts
 * const TransferPicks = Schema.Struct({
 *   sender: ITFBigInt,
 *   receiver: ITFBigInt,
 *   amount: ITFBigInt,
 * })
 * const picks = yield* pickAllFrom(step, TransferPicks)
 * // picks: { sender: bigint | undefined, receiver: bigint | undefined, amount: bigint | undefined }
 * ```
 */
export function pickAllFrom<Fields extends SchemaFields>(
  step: Step,
  struct: Schema.Struct<Fields>
): Effect.Effect<PickAllResult<Fields>, never, PickAllContext<Fields>>
export function pickAllFrom(
  step: Step,
  struct: Schema.Struct<SchemaFields>
): Effect.Effect<Record<string, unknown>, never, unknown> {
  const picksObj = Object.fromEntries(step.nondetPicks)
  const wrappedFields = Object.fromEntries(
    Object.entries(struct.fields).map(([key, fieldSchema]) => [
      key,
      Schema.UndefinedOr(ItfOption(Schema.asSchema(fieldSchema)))
    ])
  )
  return Schema.decodeUnknown(Schema.Struct(wrappedFields))(picksObj).pipe(Effect.orDie)
}
