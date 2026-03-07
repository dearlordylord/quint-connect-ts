import { describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { describe as describeV, expect, it as itV } from "vitest"
import type { Step } from "../src/driver/types.js"
import { pickAllFrom, pickFrom } from "../src/itf/picks.js"
import { ITFBigInt, ItfOption } from "../src/itf/schema.js"
import { decodeBigInt, pickAll } from "../src/simple.js"

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
      const result = yield* pickFrom(step, "amount", ITFBigInt)
      expect(result).toBe(100n)
    }))

  it.effect("returns undefined for None pick", () =>
    Effect.gen(function*() {
      const step = makeStep({
        amount: { tag: "None", value: { "#tup": [] } }
      })
      const result = yield* pickFrom(step, "amount", ITFBigInt)
      expect(result).toBeUndefined()
    }))

  it.effect("returns undefined for missing key", () =>
    Effect.gen(function*() {
      const step = makeStep({})
      const result = yield* pickFrom(step, "amount", ITFBigInt)
      expect(result).toBeUndefined()
    }))
})

describe("pickAllFrom", () => {
  const makeStep = (picks: Record<string, unknown>): Step => ({
    action: "test",
    nondetPicks: new Map(Object.entries(picks)),
    rawState: {}
  })

  const TransferPicks = Schema.Struct({
    sender: ITFBigInt,
    receiver: ITFBigInt,
    amount: ITFBigInt
  })

  it.effect("decodes all Some fields", () =>
    Effect.gen(function*() {
      const step = makeStep({
        sender: { tag: "Some", value: { "#bigint": "1" } },
        receiver: { tag: "Some", value: { "#bigint": "2" } },
        amount: { tag: "Some", value: { "#bigint": "100" } }
      })
      const picks = yield* pickAllFrom(step, TransferPicks)
      expect(picks.sender).toBe(1n)
      expect(picks.receiver).toBe(2n)
      expect(picks.amount).toBe(100n)
    }))

  it.effect("decodes None fields to undefined", () =>
    Effect.gen(function*() {
      const step = makeStep({
        sender: { tag: "Some", value: { "#bigint": "1" } },
        receiver: { tag: "None", value: { "#tup": [] } },
        amount: { tag: "None", value: { "#tup": [] } }
      })
      const picks = yield* pickAllFrom(step, TransferPicks)
      expect(picks.sender).toBe(1n)
      expect(picks.receiver).toBeUndefined()
      expect(picks.amount).toBeUndefined()
    }))

  it.effect("returns undefined for missing keys", () =>
    Effect.gen(function*() {
      const step = makeStep({
        sender: { tag: "Some", value: { "#bigint": "1" } }
      })
      const picks = yield* pickAllFrom(step, TransferPicks)
      expect(picks.sender).toBe(1n)
      expect(picks.receiver).toBeUndefined()
      expect(picks.amount).toBeUndefined()
    }))

  it.effect("handles all keys missing (empty picks)", () =>
    Effect.gen(function*() {
      const step = makeStep({})
      const picks = yield* pickAllFrom(step, TransferPicks)
      expect(picks.sender).toBeUndefined()
      expect(picks.receiver).toBeUndefined()
      expect(picks.amount).toBeUndefined()
    }))

  it.effect("works with mixed schema types", () =>
    Effect.gen(function*() {
      const MixedPicks = Schema.Struct({
        name: Schema.String,
        count: ITFBigInt
      })
      const step = makeStep({
        name: { tag: "Some", value: "alice" },
        count: { tag: "Some", value: { "#bigint": "42" } }
      })
      const picks = yield* pickAllFrom(step, MixedPicks)
      expect(picks.name).toBe("alice")
      expect(picks.count).toBe(42n)
    }))
})

describeV("pickAll (sync)", () => {
  const makeStep = (picks: Record<string, unknown>): Step => ({
    action: "test",
    nondetPicks: new Map(Object.entries(picks)),
    rawState: {}
  })

  itV("decodes all fields with user decoder", () => {
    const step = makeStep({
      sender: { tag: "Some", value: { "#bigint": "1" } },
      receiver: { tag: "Some", value: { "#bigint": "2" } },
      amount: { tag: "Some", value: { "#bigint": "100" } }
    })
    const picks = pickAll(step, (raw) => ({
      amount: decodeBigInt(raw.amount),
      receiver: decodeBigInt(raw.receiver),
      sender: decodeBigInt(raw.sender)
    }))
    expect(picks.sender).toBe(1n)
    expect(picks.receiver).toBe(2n)
    expect(picks.amount).toBe(100n)
  })

  itV("passes undefined for None values", () => {
    const step = makeStep({
      sender: { tag: "Some", value: { "#bigint": "1" } },
      receiver: { tag: "None", value: { "#tup": [] } }
    })
    const picks = pickAll(step, (raw) => ({
      receiver: raw.receiver,
      sender: raw.sender !== undefined ? decodeBigInt(raw.sender) : undefined
    }))
    expect(picks.sender).toBe(1n)
    expect(picks.receiver).toBeUndefined()
  })

  itV("handles empty picks", () => {
    const step = makeStep({})
    const picks = pickAll(step, (raw) => ({
      sender: raw.sender
    }))
    expect(picks.sender).toBeUndefined()
  })
})
