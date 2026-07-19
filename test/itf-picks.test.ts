import { describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { z } from "zod"
import { buildEffectPicksDecoder, decodeStandardPicks, pickFrom } from "../src/itf/picks.js"
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

describe("pick decoding", () => {
  it.effect("buildEffectPicksDecoder unwraps Quint Option picks and decodes Effect schemas", () =>
    Effect.gen(function*() {
      const decode = buildEffectPicksDecoder(Schema.Struct({
        amount: ITFBigInt,
        label: Schema.UndefinedOr(Schema.String)
      }))

      const result = yield* decode({
        amount: { tag: "Some", value: { "#bigint": "42" } },
        label: { tag: "None", value: { "#tup": [] } }
      })

      expect(result).toEqual({
        amount: 42n,
        label: undefined
      })
    }))

  it.effect("buildEffectPicksDecoder rejects absent required picks", () =>
    Effect.gen(function*() {
      const decode = buildEffectPicksDecoder(Schema.Struct({
        amount: ITFBigInt
      }))

      const result = yield* decode({}).pipe(
        Effect.match({
          onFailure: () => "failed" as const,
          onSuccess: () => "succeeded" as const
        })
      )

      expect(result).toBe("failed")
    }))

  it.effect("buildEffectPicksDecoder allows absent optional picks", () =>
    Effect.gen(function*() {
      const decode = buildEffectPicksDecoder(Schema.Struct({
        amount: Schema.UndefinedOr(ITFBigInt)
      }))

      const result = yield* decode({})

      expect(result).toEqual({
        amount: undefined
      })
    }))

  it("decodeStandardPicks transforms raw ITF values before Standard Schema validation", async () => {
    const result = await decodeStandardPicks(
      {
        amount: { "#bigint": "7" },
        label: undefined
      },
      {
        amount: z.bigint(),
        label: z.string().optional()
      }
    )

    expect(result).toEqual({
      amount: 7n,
      label: undefined
    })
  })

  it("decodeStandardPicks reports the failing pick name", async () => {
    await expect(decodeStandardPicks(
      {
        amount: "not a bigint"
      },
      {
        amount: z.bigint()
      }
    )).rejects.toThrow("Pick \"amount\" validation failed")
  })

  it("pickFrom preserves raw-mode Quint Option decoding", () => {
    const picks = new Map<string, unknown>([
      ["amount", { tag: "Some", value: { "#bigint": "9" } }],
      ["missingAmount", { tag: "None", value: { "#tup": [] } }]
    ])

    expect(pickFrom(picks, "amount", z.bigint())).toBe(9n)
    expect(pickFrom(picks, "missingAmount", z.bigint())).toBeUndefined()
    expect(pickFrom(picks, "absent", z.bigint())).toBeUndefined()
  })

  it("pickFrom preserves existing malformed pick errors", () => {
    expect(() => pickFrom(new Map([["amount", 1]]), "amount", z.bigint()))
      .toThrow("pickFrom \"amount\": expected Quint Option (Some/None), got: 1")

    expect(() => pickFrom(new Map([["amount", { tag: "Other" }]]), "amount", z.bigint()))
      .toThrow("pickFrom \"amount\": expected Option tag \"Some\" or \"None\", got: \"Other\"")
  })

  it("pickFrom validates malformed Some values instead of treating them as None", () => {
    expect(() => pickFrom(new Map([["amount", { tag: "Some" }]]), "amount", z.bigint()))
      .toThrow("pickFrom \"amount\" validation failed")
  })
})
