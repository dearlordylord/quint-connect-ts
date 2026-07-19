import { ITFVariant, UntypedTraceSchema } from "@firfi/itf-trace-parser/effect"
import { Schema } from "effect"

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

export const ItfOption = <A, I, R>(inner: Schema.Schema<A, I, R>) =>
  Schema.transform(
    ITFVariant({ Some: inner, None: Schema.Unknown }),
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

export const MbtMeta = Schema.Struct({
  "mbt::actionTaken": Schema.String,
  "mbt::nondetPicks": Schema.Record({ key: Schema.String, value: Schema.Unknown })
})

export type MbtMeta = typeof MbtMeta.Type

export const ItfTrace = UntypedTraceSchema

export type ItfTrace = typeof ItfTrace.Type
