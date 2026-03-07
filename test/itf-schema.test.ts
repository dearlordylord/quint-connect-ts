import { describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { describe as stdDescribe, expect, it as stdIt } from "vitest"
import { ITFBigInt, ITFMap, ITFSet, ItfTrace, ITFTuple, ITFUnserializable, MbtMeta } from "../src/itf/schema.js"
import { decodeBigInt, decodeList, decodeMap, decodeSet, decodeTuple, decodeUnserializable } from "../src/simple.js"

describe("ITF Schema", () => {
  describe("ITFBigInt", () => {
    it.effect("decodes bigint from ITF format", () =>
      Effect.gen(function*() {
        const result = yield* Schema.decodeUnknown(ITFBigInt)({ "#bigint": "42" })
        expect(result).toBe(42n)
      }))

    it.effect("decodes negative bigint", () =>
      Effect.gen(function*() {
        const result = yield* Schema.decodeUnknown(ITFBigInt)({ "#bigint": "-100" })
        expect(result).toBe(-100n)
      }))
  })

  describe("ITFSet", () => {
    it.effect("decodes set of numbers", () =>
      Effect.gen(function*() {
        const NumberSet = ITFSet(Schema.Number)
        const result = yield* Schema.decodeUnknown(NumberSet)({ "#set": [1, 2, 3] })
        expect(result).toEqual(new Set([1, 2, 3]))
      }))

    it.effect("decodes empty set", () =>
      Effect.gen(function*() {
        const NumberSet = ITFSet(Schema.Number)
        const result = yield* Schema.decodeUnknown(NumberSet)({ "#set": [] })
        expect(result).toEqual(new Set())
      }))
  })

  describe("ITFMap", () => {
    it.effect("decodes map from ITF format", () =>
      Effect.gen(function*() {
        const StringToNumber = ITFMap(Schema.String, Schema.Number)
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

  describe("ITFTuple", () => {
    it.effect("decodes a tuple of two bigints", () =>
      Effect.gen(function*() {
        const PairSchema = ITFTuple(ITFBigInt, ITFBigInt)
        const result = yield* Schema.decodeUnknown(PairSchema)({
          "#tup": [{ "#bigint": "1" }, { "#bigint": "2" }]
        })
        expect(result).toEqual([1n, 2n])
      }))

    it.effect("decodes an empty tuple", () =>
      Effect.gen(function*() {
        const EmptySchema = ITFTuple()
        const result = yield* Schema.decodeUnknown(EmptySchema)({ "#tup": [] })
        expect(result).toEqual([])
      }))

    it.effect("decodes a mixed tuple", () =>
      Effect.gen(function*() {
        const MixedSchema = ITFTuple(Schema.String, ITFBigInt, Schema.Boolean)
        const result = yield* Schema.decodeUnknown(MixedSchema)({
          "#tup": ["hello", { "#bigint": "42" }, true]
        })
        expect(result).toEqual(["hello", 42n, true])
      }))
  })

  describe("ITFUnserializable", () => {
    it.effect("decodes unserializable value", () =>
      Effect.gen(function*() {
        const result = yield* Schema.decodeUnknown(ITFUnserializable)({
          "#unserializable": "lambda"
        })
        expect(result).toEqual({ "#unserializable": "lambda" })
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

stdDescribe("Sync ITF decoders", () => {
  stdDescribe("decodeBigInt", () => {
    stdIt("decodes bigint", () => {
      expect(decodeBigInt({ "#bigint": "42" })).toBe(42n)
    })

    stdIt("decodes negative bigint", () => {
      expect(decodeBigInt({ "#bigint": "-100" })).toBe(-100n)
    })

    stdIt("throws on invalid input", () => {
      expect(() => decodeBigInt("not a bigint")).toThrow()
    })
  })

  stdDescribe("decodeSet", () => {
    stdIt("decodes set with decoder", () => {
      const result = decodeSet(
        { "#set": [{ "#bigint": "1" }, { "#bigint": "2" }] },
        decodeBigInt
      )
      expect(result).toEqual(new Set([1n, 2n]))
    })

    stdIt("decodes empty set", () => {
      const result = decodeSet({ "#set": [] }, (x) => x)
      expect(result).toEqual(new Set())
    })
  })

  stdDescribe("decodeMap", () => {
    stdIt("decodes map with decoders", () => {
      const result = decodeMap(
        { "#map": [["a", { "#bigint": "1" }], ["b", { "#bigint": "2" }]] },
        String,
        decodeBigInt
      )
      expect(result).toEqual(new Map([["a", 1n], ["b", 2n]]))
    })

    stdIt("decodes empty map", () => {
      const result = decodeMap({ "#map": [] }, (x) => x, (x) => x)
      expect(result).toEqual(new Map())
    })
  })

  stdDescribe("decodeTuple", () => {
    stdIt("decodes tuple elements", () => {
      const result = decodeTuple({ "#tup": [1, "hello", true] })
      expect(result).toEqual([1, "hello", true])
    })

    stdIt("decodes empty tuple", () => {
      const result = decodeTuple({ "#tup": [] })
      expect(result).toEqual([])
    })

    stdIt("decodes nested ITF values in tuple", () => {
      const result = decodeTuple({ "#tup": [{ "#bigint": "42" }, "x"] })
      expect(result[0]).toEqual({ "#bigint": "42" })
      expect(decodeBigInt(result[0])).toBe(42n)
      expect(result[1]).toBe("x")
    })

    stdIt("throws on non-tuple input", () => {
      expect(() => decodeTuple([1, 2])).toThrow()
      expect(() => decodeTuple("not a tuple")).toThrow()
    })
  })

  stdDescribe("decodeList", () => {
    stdIt("decodes list with item decoder", () => {
      const result = decodeList(
        [{ "#bigint": "1" }, { "#bigint": "2" }, { "#bigint": "3" }],
        decodeBigInt
      )
      expect(result).toEqual([1n, 2n, 3n])
    })

    stdIt("decodes empty list", () => {
      const result = decodeList([], (x) => x)
      expect(result).toEqual([])
    })

    stdIt("decodes list of strings (identity)", () => {
      const result = decodeList(["a", "b", "c"], String)
      expect(result).toEqual(["a", "b", "c"])
    })

    stdIt("throws on non-array input", () => {
      expect(() => decodeList("not an array", (x) => x)).toThrow()
    })
  })

  stdDescribe("decodeUnserializable", () => {
    stdIt("extracts unserializable string", () => {
      expect(decodeUnserializable({ "#unserializable": "lambda" })).toBe("lambda")
    })

    stdIt("extracts empty unserializable string", () => {
      expect(decodeUnserializable({ "#unserializable": "" })).toBe("")
    })

    stdIt("throws on invalid input", () => {
      expect(() => decodeUnserializable({ wrong: "key" })).toThrow()
      expect(() => decodeUnserializable("not an object")).toThrow()
    })
  })
})
