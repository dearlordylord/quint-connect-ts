import { transformITFValue } from "@firfi/itf-trace-parser"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import { Effect, Schema } from "effect"

import { ItfOption } from "./schema.js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EffectPicksFields = Record<string, Schema.Schema<any, any, never>>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StandardPicksSchema = Record<string, StandardSchemaV1<any, any>>

type StandardPicksOutput<Fields extends StandardPicksSchema> = {
  readonly [K in keyof Fields]: StandardSchemaV1.InferOutput<Fields[K]>
}

const assumeNoSchemaRequirements = (
  schema: unknown
): Schema.Schema<unknown, unknown, never> =>
  // ItfOption preserves the action pick schema requirements, but extraction widens R.
  schema as Schema.Schema<unknown, unknown, never>

export const buildEffectPicksDecoder = <Fields extends EffectPicksFields>(
  picksShape: Schema.Struct<Fields>
) =>
(rawPicks: unknown) =>
  Effect.gen(function*() {
    if (typeof rawPicks !== "object" || rawPicks === null) {
      return yield* Schema.decodeUnknown(Schema.Struct({}))(rawPicks)
    }

    const record = rawPicks as { readonly [key: string]: unknown }
    const decoded: Record<string, unknown> = {}

    for (const [key, fieldSchema] of Object.entries(picksShape.fields)) {
      const schema = assumeNoSchemaRequirements(Schema.asSchema(fieldSchema))
      const raw = record[key]

      if (raw === undefined) {
        decoded[key] = yield* Schema.decodeUnknown(schema)(undefined)
        continue
      }

      const value = yield* Schema.decodeUnknown(ItfOption(schema))(raw)
      if (value === undefined) {
        decoded[key] = yield* Schema.decodeUnknown(schema)(undefined)
        continue
      }

      decoded[key] = value
    }

    return decoded as typeof picksShape.Type
  })

const formatIssues = (issues: ReadonlyArray<StandardSchemaV1.Issue>): string =>
  issues.map((issue) => issue.message).join(", ")

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
): Promise<StandardPicksOutput<Fields>> => {
  const decoded = await Promise.all(
    Object.entries(picksSchema).map(async ([key, schema]) => [
      key,
      await decodeStandardPickValue(rawPicks[key], key, schema)
    ])
  )
  return Object.fromEntries(decoded) as StandardPicksOutput<Fields>
}

const unwrapQuintOptionPick = (
  raw: unknown,
  key: string
): { readonly present: false } | { readonly present: true; readonly value: unknown } | undefined => {
  if (raw === undefined) return undefined
  if (typeof raw !== "object" || raw === null || !("tag" in raw)) {
    throw new Error(`pickFrom "${key}": expected Quint Option (Some/None), got: ${JSON.stringify(raw)}`)
  }

  const variant = raw as { readonly tag: string; readonly value?: unknown }
  if (variant.tag === "None") return { present: false }
  if (variant.tag !== "Some") {
    throw new Error(`pickFrom "${key}": expected Option tag "Some" or "None", got: "${variant.tag}"`)
  }
  return { present: true, value: variant.value }
}

export const pickFrom = <T>(
  nondetPicks: ReadonlyMap<string, unknown>,
  key: string,
  schema: StandardSchemaV1<unknown, T>
): T | undefined => {
  const pick = unwrapQuintOptionPick(nondetPicks.get(key), key)
  return pick === undefined || !pick.present ? undefined : decodeStandardPickValueSync(pick.value, key, schema)
}
