import { Schema } from "effect"

// ITF special type encodings per Apalache ADR-015

export const ItfBigInt = Schema.transform(
  Schema.Struct({ "#bigint": Schema.String }),
  Schema.BigIntFromSelf,
  {
    strict: true,
    decode: (v) => BigInt(v["#bigint"]),
    encode: (n) => ({ "#bigint": String(n) })
  }
)

export const ItfSet = <A, I, R>(item: Schema.Schema<A, I, R>) =>
  Schema.transform(
    Schema.Struct({ "#set": Schema.Array(item) }),
    Schema.ReadonlySetFromSelf(Schema.typeSchema(item)),
    {
      strict: true,
      decode: (v) => new Set(v["#set"]),
      encode: (s) => ({ "#set": [...s] })
    }
  )

export const ItfMap = <K, KI, KR, V, VI, VR>(
  key: Schema.Schema<K, KI, KR>,
  value: Schema.Schema<V, VI, VR>
) =>
  Schema.transform(
    Schema.Struct({ "#map": Schema.Array(Schema.Tuple(key, value)) }),
    Schema.ReadonlyMapFromSelf({ key: Schema.typeSchema(key), value: Schema.typeSchema(value) }),
    {
      strict: true,
      decode: (v) => new Map(v["#map"]),
      encode: (m) => ({ "#map": [...m.entries()] })
    }
  )

export const ItfUnserializable = Schema.Struct({ "#unserializable": Schema.String })

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

export type ItfValue =
  | boolean
  | string
  | number
  | bigint
  | ReadonlyArray<ItfValue>
  | ReadonlySet<ItfValue>
  | ReadonlyMap<ItfValue, ItfValue>
  | { readonly [key: string]: ItfValue }

export const MbtMeta = Schema.Struct({
  "mbt::actionTaken": Schema.String,
  "mbt::nondetPicks": Schema.Record({ key: Schema.String, value: Schema.Unknown })
})

export type MbtMeta = typeof MbtMeta.Type

export const ItfTrace = Schema.Struct({
  vars: Schema.Array(Schema.String),
  states: Schema.Array(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  "#meta": Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  loop: Schema.optional(Schema.Number),
  params: Schema.optional(Schema.Array(Schema.String))
})

export type ItfTrace = typeof ItfTrace.Type
