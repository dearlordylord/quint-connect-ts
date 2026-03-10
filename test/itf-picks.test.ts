import { describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { ITFBigInt, ItfOption } from "../src/itf/schema.js"

describe("ItfOption", () => {
  const OptionBigInt = ItfOption(ITFBigInt)

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
