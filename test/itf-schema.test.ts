import { describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { ItfBigInt, ItfMap, ItfSet, ItfTrace, MbtMeta } from "../src/itf/schema.js"

describe("ITF Schema", () => {
  describe("ItfBigInt", () => {
    it.effect("decodes bigint from ITF format", () =>
      Effect.gen(function*() {
        const result = yield* Schema.decodeUnknown(ItfBigInt)({ "#bigint": "42" })
        expect(result).toBe(42n)
      }))

    it.effect("decodes negative bigint", () =>
      Effect.gen(function*() {
        const result = yield* Schema.decodeUnknown(ItfBigInt)({ "#bigint": "-100" })
        expect(result).toBe(-100n)
      }))
  })

  describe("ItfSet", () => {
    it.effect("decodes set of numbers", () =>
      Effect.gen(function*() {
        const NumberSet = ItfSet(Schema.Number)
        const result = yield* Schema.decodeUnknown(NumberSet)({ "#set": [1, 2, 3] })
        expect(result).toEqual(new Set([1, 2, 3]))
      }))

    it.effect("decodes empty set", () =>
      Effect.gen(function*() {
        const NumberSet = ItfSet(Schema.Number)
        const result = yield* Schema.decodeUnknown(NumberSet)({ "#set": [] })
        expect(result).toEqual(new Set())
      }))
  })

  describe("ItfMap", () => {
    it.effect("decodes map from ITF format", () =>
      Effect.gen(function*() {
        const StringToNumber = ItfMap(Schema.String, Schema.Number)
        const result = yield* Schema.decodeUnknown(StringToNumber)({
          "#map": [["a", 1], ["b", 2]]
        })
        expect(result).toEqual(new Map([["a", 1], ["b", 2]]))
      }))
  })

  describe("MbtMeta", () => {
    it.effect("decodes MBT metadata from trace state", () =>
      Effect.gen(function*() {
        const result = yield* Schema.decodeUnknown(MbtMeta)({
          "mbt::actionTaken": "Transfer",
          "mbt::nondetPicks": { sender: { "#bigint": "1" }, amount: { "#bigint": "50" } }
        })
        expect(result["mbt::actionTaken"]).toBe("Transfer")
        expect(result["mbt::nondetPicks"]).toEqual({
          sender: { "#bigint": "1" },
          amount: { "#bigint": "50" }
        })
      }))
  })

  describe("ItfTrace", () => {
    it.effect("decodes a minimal trace", () =>
      Effect.gen(function*() {
        const result = yield* Schema.decodeUnknown(ItfTrace)({
          vars: ["balance", "step"],
          states: [
            {
              "#meta": { index: 0 },
              "balance": { "#bigint": "100" },
              "mbt::actionTaken": "init",
              "mbt::nondetPicks": {}
            }
          ]
        })
        expect(result.vars).toEqual(["balance", "step"])
        expect(result.states).toHaveLength(1)
      }))
  })
})
