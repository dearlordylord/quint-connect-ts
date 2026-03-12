/**
 * Effect 4 compatible ITF schemas.
 * Replaces @firfi/itf-trace-parser/effect which is compiled against Effect 3.
 *
 * TODO: Remove this file once @firfi/itf-trace-parser supports Effect 4.
 */
import type { Schema as SchemaT } from "effect"
import { Schema, SchemaGetter } from "effect"

const BigIntStringPattern = /^-?[0-9]+$/

const BigIntStringSchema = Schema.String.check(Schema.isPattern(BigIntStringPattern))

export const ITFBigInt = Schema.Struct({ "#bigint": BigIntStringSchema }).pipe(
  Schema.decodeTo(Schema.BigInt, {
    decode: SchemaGetter.transform(
      (v: { readonly "#bigint": string }) => globalThis.BigInt(v["#bigint"])
    ),
    encode: SchemaGetter.transform(
      (n: bigint) => ({ "#bigint": String(n) })
    )
  })
)

export const ITFSet: <A>(itemSchema: Schema.Schema<A>) => SchemaT.Codec<ReadonlySet<A>> = <A>(
  itemSchema: Schema.Schema<A>
) =>
  Schema.Struct({ "#set": Schema.Array(itemSchema) }).pipe(
    Schema.decodeTo(Schema.ReadonlySet(Schema.toType(itemSchema)), {
      decode: SchemaGetter.transform(
        (v: { readonly "#set": ReadonlyArray<A> }) => new Set(v["#set"]) as ReadonlySet<A>
      ),
      encode: SchemaGetter.transform(
        (s: ReadonlySet<A>) => ({ "#set": Array.from(s.values()) })
      )
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any

export const ITFMap: <KA, VA>(
  keySchema: Schema.Schema<KA>,
  valueSchema: Schema.Schema<VA>
) => SchemaT.Codec<ReadonlyMap<KA, VA>> = <KA, VA>(
  keySchema: Schema.Schema<KA>,
  valueSchema: Schema.Schema<VA>
) =>
  Schema.Struct({
    "#map": Schema.Array(Schema.Tuple([keySchema, valueSchema]))
  }).pipe(
    Schema.decodeTo(Schema.ReadonlyMap(Schema.toType(keySchema), Schema.toType(valueSchema)), {
      decode: SchemaGetter.transform(
        (v: { readonly "#map": ReadonlyArray<readonly [KA, VA]> }) => new Map(v["#map"]) as ReadonlyMap<KA, VA>
      ),
      encode: SchemaGetter.transform(
        (m: ReadonlyMap<KA, VA>) => ({
          "#map": Array.from(m.entries())
        })
      )
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ITFTuple = <Elements extends ReadonlyArray<Schema.Schema<any>>>(
  ...schemas: Elements
) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tupleSchema = Schema.Tuple(schemas as any)
  return Schema.Struct({ "#tup": tupleSchema }).pipe(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Schema.decodeTo(Schema.toType(tupleSchema) as any, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      decode: SchemaGetter.transform((v: any) => v["#tup"]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      encode: SchemaGetter.transform((items: any) => ({ "#tup": items }))
    })
  )
}

export const ITFVariant = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Cases extends Record<string, Schema.Schema<any>>
>(cases: Cases) => {
  const members = Object.entries(cases).map(
    ([tag, schema]) => Schema.Struct({ tag: Schema.Literal(tag), value: schema })
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Schema.Union(members as any)
}

export const ITFList = <A>(itemSchema: Schema.Schema<A>): Schema.Schema<ReadonlyArray<A>> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Schema.Array(itemSchema) as any

export const ITFUnserializable = Schema.Struct({
  "#unserializable": Schema.String
})

const suspendValue: Schema.Schema<unknown> = Schema.suspend(() => ITFValueRawSchema)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ITFValueRawSchema: Schema.Schema<any> = Schema.Union([
  Schema.Boolean,
  Schema.String,
  Schema.Struct({ "#bigint": BigIntStringSchema }),
  Schema.Struct({ "#unserializable": Schema.String }),
  Schema.Struct({ "#set": Schema.Array(suspendValue) }),
  Schema.Struct({ "#map": Schema.Array(Schema.Tuple([suspendValue, suspendValue])) }),
  Schema.Struct({ "#tup": Schema.Array(suspendValue) }),
  Schema.Struct({ tag: Schema.NonEmptyString, value: suspendValue }),
  Schema.Array(suspendValue),
  Schema.Record(Schema.String, suspendValue)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as any)

const NonNegativeInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const TraceMetaSchema = Schema.Struct({
  format: Schema.optional(Schema.String),
  "format-description": Schema.optional(Schema.String),
  description: Schema.optional(Schema.String)
})

export const UntypedTraceSchema = Schema.Struct({
  "#meta": Schema.optional(TraceMetaSchema),
  params: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  loop: Schema.optional(NonNegativeInt),
  vars: Schema.Array(Schema.String),
  states: Schema.Array(Schema.Record(Schema.String, Schema.Unknown))
})
