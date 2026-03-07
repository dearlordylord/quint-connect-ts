import { describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import type { Step } from "../src/driver/types.js"
import { pickFrom } from "../src/itf/picks.js"
import { ItfBigInt, ItfOption } from "../src/itf/schema.js"

describe("ItfOption", () => {
  const OptionBigInt = ItfOption(ItfBigInt)

  it.effect("decodes Some(bigint)", () =>
    Effect.gen(function*() {
      const result = yield* Schema.decodeUnknown(OptionBigInt)({
        tag: "Some",
        value: { "#bigint": "42" }
      })
      expect(result).toBe(42n)
    }))

  it.effect("decodes None to undefined", () =>
    Effect.gen(function*() {
      const result = yield* Schema.decodeUnknown(OptionBigInt)({
        tag: "None",
        value: { "#tup": [] }
      })
      expect(result).toBeUndefined()
    }))

  it.effect("works with plain string inner schema", () =>
    Effect.gen(function*() {
      const OptionString = ItfOption(Schema.String)
      const some = yield* Schema.decodeUnknown(OptionString)({
        tag: "Some",
        value: "hello"
      })
      expect(some).toBe("hello")

      const none = yield* Schema.decodeUnknown(OptionString)({
        tag: "None",
        value: { "#tup": [] }
      })
      expect(none).toBeUndefined()
    }))
})

describe("pickFrom", () => {
  const makeStep = (picks: Record<string, unknown>): Step => ({
    action: "test",
    nondetPicks: new Map(Object.entries(picks)),
    rawState: {}
  })

  it.effect("extracts a Some(bigint) pick", () =>
    Effect.gen(function*() {
      const step = makeStep({
        amount: { tag: "Some", value: { "#bigint": "100" } }
      })
      const result = yield* pickFrom(step, "amount", ItfBigInt)
      expect(result).toBe(100n)
    }))

  it.effect("returns undefined for None pick", () =>
    Effect.gen(function*() {
      const step = makeStep({
        amount: { tag: "None", value: { "#tup": [] } }
      })
      const result = yield* pickFrom(step, "amount", ItfBigInt)
      expect(result).toBeUndefined()
    }))

  it.effect("returns undefined for missing key", () =>
    Effect.gen(function*() {
      const step = makeStep({})
      const result = yield* pickFrom(step, "amount", ItfBigInt)
      expect(result).toBeUndefined()
    }))
})
