import { Schema, SchemaGetter } from "effect"

import { ITFVariant, UntypedTraceSchema } from "@firfi/itf-trace-parser/effect"

export {
  ITFBigInt,
  ITFList,
  ITFMap,
  ITFSet,
  ITFTuple,
  ITFUnserializable,
  ITFVariant,
  UntypedTraceSchema
} from "@firfi/itf-trace-parser/effect"

export type { ITFValueRaw } from "@firfi/itf-trace-parser"

// Quint encodes nondet picks as Option variants:
// Some(x) = { tag: "Some", value: x }
// None    = { tag: "None", value: { "#tup": [] } }

export const ItfOption = <A>(inner: Schema.Schema<A>) =>
  ITFVariant({ Some: inner, None: Schema.Unknown }).pipe(
    Schema.decodeTo(
      Schema.UndefinedOr(Schema.toType(inner)),
      {
        decode: SchemaGetter.transform((variant) => variant.tag === "Some" ? variant.value : undefined),
        encode: SchemaGetter.transform((value) =>
          value !== undefined
            ? { tag: "Some", value }
            : { tag: "None", value: { "#tup": [] } }
        )
      }
    )
  )

export const MbtMeta = Schema.Struct({
  "mbt::actionTaken": Schema.String,
  "mbt::nondetPicks": Schema.Record(Schema.String, Schema.Unknown)
})

export type MbtMeta = typeof MbtMeta.Type

export const ItfTrace = UntypedTraceSchema

export type ItfTrace = typeof ItfTrace.Type
