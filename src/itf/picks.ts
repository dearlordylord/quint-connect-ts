import { transformITFValue } from "@firfi/itf-trace-parser"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import { Effect, Option, Predicate, Schema } from "effect"

import { ItfOption } from "./schema.js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EffectPicksFields = Record<string, Schema.Schema<any>>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StandardPicksSchema = Record<string, StandardSchemaV1<any, any>>

export const buildEffectPicksDecoder = <Fields extends EffectPicksFields>(
  picksShape: Schema.Struct<Fields>
) =>
(rawPicks: unknown) =>
  Effect.gen(function*() {
    if (!Predicate.isObject(rawPicks)) {
      return yield* Schema.decodeUnknownEffect(picksShape)(rawPicks)
    }

    const decoded: Record<string, unknown> = {}
    for (const [key, fieldSchema] of Object.entries(picksShape.fields)) {
      const raw = rawPicks[key]
      if (raw === undefined) {
        decoded[key] = yield* Schema.decodeUnknownEffect(fieldSchema)(undefined)
        continue
      }

      const value = yield* Schema.decodeUnknownEffect(ItfOption(fieldSchema))(raw)
      decoded[key] = value === undefined
        ? yield* Schema.decodeUnknownEffect(fieldSchema)(undefined)
        : value
    }
    return yield* Schema.decodeUnknownEffect(Schema.toType(picksShape))(decoded)
  })

const formatIssues = (issues: ReadonlyArray<StandardSchemaV1.Issue>): string =>
  issues.map((issue) => issue.message).join(", ")

const QuintSomePick = Schema.Struct({
  tag: Schema.Literal("Some"),
  value: Schema.Unknown
})
const QuintNonePick = Schema.Struct({
  tag: Schema.Literal("None"),
  value: Schema.optional(Schema.Unknown)
})
const QuintOptionPick = Schema.Union([QuintSomePick, QuintNonePick])
const QuintOptionTag = Schema.Struct({ tag: Schema.String })

const decodeStandardPickValueSync = <T>(
  rawValue: unknown,
  key: string,
  schema: StandardSchemaV1<unknown, T>
): T => {
  const result = schema["~standard"].validate(transformITFValue(rawValue))
  if (result instanceof Promise) {
    throw new Error("pickFrom does not support async schemas")
  }
  if (result.issues) {
    throw new Error(`pickFrom "${key}" validation failed: ${formatIssues(result.issues)}`)
  }
  return result.value
}

const decodeStandardPickValue = async <T>(
  rawValue: unknown,
  key: string,
  schema: StandardSchemaV1<unknown, T>
): Promise<T> => {
  const result = await schema["~standard"].validate(transformITFValue(rawValue))
  if (result.issues) {
    throw new Error(`Pick "${key}" validation failed: ${formatIssues(result.issues)}`)
  }
  return result.value
}

export const decodeStandardPicks = async <Fields extends StandardPicksSchema>(
  rawPicks: { readonly [key: string]: unknown },
  picksSchema: Fields
): Promise<Readonly<Record<string, unknown>>> => {
  const decoded = await Promise.all(
    Object.entries(picksSchema).map(async ([key, schema]) => [
      key,
      await decodeStandardPickValue(rawPicks[key], key, schema)
    ])
  )
  return Object.fromEntries(decoded)
}

const unwrapQuintOptionPick = (
  raw: unknown,
  key: string
): { readonly present: false } | { readonly present: true; readonly value: unknown } | undefined => {
  if (raw === undefined) return undefined
  const decoded = Schema.decodeUnknownOption(QuintOptionPick)(raw)
  if (Option.isSome(decoded)) {
    return decoded.value.tag === "None"
      ? { present: false }
      : { present: true, value: decoded.value.value }
  }
  const decodedTag = Schema.decodeUnknownOption(QuintOptionTag)(raw)
  if (Option.isSome(decodedTag)) {
    throw new Error(`pickFrom "${key}": expected Option tag "Some" or "None", got: "${decodedTag.value.tag}"`)
  }
  throw new Error(`pickFrom "${key}": expected Quint Option (Some/None), got: ${JSON.stringify(raw)}`)
}

export const pickFrom = <T>(
  nondetPicks: ReadonlyMap<string, unknown>,
  key: string,
  schema: StandardSchemaV1<unknown, T>
): T | undefined => {
  const pick = unwrapQuintOptionPick(nondetPicks.get(key), key)
  return pick === undefined || !pick.present ? undefined : decodeStandardPickValueSync(pick.value, key, schema)
}
