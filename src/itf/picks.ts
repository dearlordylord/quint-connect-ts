import { Effect, Schema } from "effect"
import type { Step } from "../driver/types.js"

// Quint encodes nondet picks as Option variants:
// Some(x) = { tag: "Some", value: x }
// None    = { tag: "None", value: { "#tup": [] } }

const ItfNone = Schema.Struct({
  tag: Schema.Literal("None"),
  value: Schema.Unknown
})

const ItfSome = <A, I, R>(inner: Schema.Schema<A, I, R>) =>
  Schema.Struct({
    tag: Schema.Literal("Some"),
    value: inner
  })

export const ItfOption = <A, I, R>(inner: Schema.Schema<A, I, R>) =>
  Schema.transform(
    Schema.Union(ItfSome(inner), ItfNone),
    Schema.UndefinedOr(Schema.typeSchema(inner)),
    {
      strict: true,
      decode: (v) => v.tag === "Some" ? v.value : undefined,
      encode: (v) =>
        v !== undefined
          ? { tag: "Some" as const, value: v }
          : { tag: "None" as const, value: { "#tup": [] } }
    }
  )

export const pickFrom = <A, I, R>(
  step: Step,
  key: string,
  schema: Schema.Schema<A, I, R>
): Effect.Effect<A | undefined, never, R> => {
  const raw = step.nondetPicks.get(key)
  if (raw === undefined) return Effect.succeed(undefined)
  return Schema.decodeUnknown(ItfOption(schema))(raw).pipe(Effect.orDie)
}
