import { describe, expect, it } from "vitest"
import { ITFBigInt, ITFMap, ITFSet, TraceCodec } from "../src/zod.js"

describe("zod re-exports", () => {
  it("ITFBigInt is a zod bigint schema", () => {
    const result = ITFBigInt.parse(42n)
    expect(result).toBe(42n)
  })

  it("ITFSet produces a zod set schema", () => {
    const result = ITFSet(ITFBigInt).parse(new Set([1n, 2n]))
    expect(result).toEqual(new Set([1n, 2n]))
  })

  it("ITFMap produces a zod map schema", () => {
    const result = ITFMap(ITFBigInt, ITFBigInt).parse(new Map([[1n, 10n]]))
    expect(result).toEqual(new Map([[1n, 10n]]))
  })

  it("TraceCodec decodes ITF trace JSON", () => {
    const codec = TraceCodec({ balance: ITFBigInt })
    const trace = codec.decode({
      vars: ["balance"],
      states: [
        { "#meta": { index: 0 }, "balance": { "#bigint": "100" } }
      ]
    })
    expect(trace.states[0].balance).toBe(100n)
  })
})
