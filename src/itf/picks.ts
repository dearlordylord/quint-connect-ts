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
