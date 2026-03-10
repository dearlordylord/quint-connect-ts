import { describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"

import { ITFBigInt } from "@firfi/itf-trace-parser/effect"

import { defaultConfig } from "../src/driver/types.js"
import type { Driver, PartialActionMap } from "../src/driver/types.js"
import { defineDriver, stateCheck } from "../src/effect.js"
import type { ItfTrace } from "../src/itf/schema.js"
import { jsonReplacer, replayTrace, StateMismatchError, stripMetadata, TraceReplayError } from "../src/runner/runner.js"

// ---------------------------------------------------------------------------
// T1a: stripMetadata
// ---------------------------------------------------------------------------

describe("stripMetadata", () => {
  it("removes #meta and mbt:: keys", () => {
    const raw = {
      "#meta": { index: 1 },
      "mbt::actionTaken": "Increment",
      "mbt::nondetPicks": { amount: 1 },
      count: 42
    }
    const result = stripMetadata(raw)
    expect(result).toEqual({ count: 42 })
    expect("#meta" in result).toBe(false)
    expect("mbt::actionTaken" in result).toBe(false)
    expect("mbt::nondetPicks" in result).toBe(false)
  })

  it("returns empty object when all keys are metadata", () => {
    const raw = {
      "#meta": {},
      "mbt::actionTaken": "Init",
      "mbt::nondetPicks": {}
    }
    expect(stripMetadata(raw)).toEqual({})
  })

  it("returns all keys when no metadata present", () => {
    const raw = { a: 1, b: "hello" }
    expect(stripMetadata(raw)).toEqual({ a: 1, b: "hello" })
  })
})

// ---------------------------------------------------------------------------
// T1a: deserializeState receives stripped state (no metadata keys)
// ---------------------------------------------------------------------------

describe("replayTrace strips metadata before deserializeState (T1a)", () => {
  it.effect("deserializeState does not receive #meta or mbt:: keys when statePath is empty", () =>
    Effect.gen(function*() {
      const receivedRaws: Array<unknown> = []

      const trace: ItfTrace = {
        vars: ["count", "mbt::actionTaken", "mbt::nondetPicks"],
        states: [
          // Step 0 (init, skipped)
          {
            "#meta": { index: 0 },
            "mbt::actionTaken": "",
            "mbt::nondetPicks": {},
            count: { "#bigint": "0" }
          },
          // Step 1
          {
            "#meta": { index: 1 },
            "mbt::actionTaken": "Increment",
            "mbt::nondetPicks": {
              amount: { tag: "Some", value: { "#bigint": "5" } }
            },
            count: { "#bigint": "5" }
          }
        ]
      }

      const factory = defineDriver(
        { Increment: { amount: ITFBigInt } },
        () => ({
          Increment: () => Effect.void,
          getState: () => Effect.succeed({ count: 5n })
        })
      )
      const driver = yield* factory.create()

      yield* replayTrace(
        trace,
        0,
        driver,
        defaultConfig,
        stateCheck(
          (raw) => {
            receivedRaws.push(raw)
            return Schema.decodeUnknown(Schema.Struct({ count: ITFBigInt }))(raw).pipe(Effect.orDie)
          },
          () => true
        ),
        "test-seed"
      )

      expect(receivedRaws.length).toBe(1)
      const received = receivedRaws[0]
      expect(received).toBeDefined()
      expect(typeof received === "object" && received !== null).toBe(true)
      if (typeof received !== "object" || received === null) throw new Error("unexpected")
      const keys = Object.keys(received)
      expect(keys).not.toContain("#meta")
      expect(keys).not.toContain("mbt::actionTaken")
      expect(keys).not.toContain("mbt::nondetPicks")
      expect(keys).toContain("count")
    }))
})

// ---------------------------------------------------------------------------
// T1b: "init" action error contains helpful hint
// ---------------------------------------------------------------------------

describe("replayTrace unknown action error messages (T1b)", () => {
  const makeTrace = (actionName: string): ItfTrace => ({
    vars: ["count", "mbt::actionTaken", "mbt::nondetPicks"],
    states: [
      {
        "#meta": { index: 0 },
        "mbt::actionTaken": "",
        "mbt::nondetPicks": {},
        count: { "#bigint": "0" }
      },
      {
        "#meta": { index: 1 },
        "mbt::actionTaken": actionName,
        "mbt::nondetPicks": {},
        count: { "#bigint": "1" }
      }
    ]
  })

  const emptyDriver: Driver<unknown, never, never, PartialActionMap> = {
    actions: {}
  }

  it.effect("unknown action 'init' includes the typescript backend bug hint", () =>
    Effect.gen(function*() {
      const result = yield* replayTrace(
        makeTrace("init"),
        0,
        emptyDriver,
        defaultConfig,
        undefined,
        "test-seed"
      ).pipe(
        Effect.match({
          onFailure: (e) => e,
          onSuccess: () => undefined
        })
      )

      expect(result).toBeInstanceOf(TraceReplayError)
      if (result instanceof TraceReplayError) {
        expect(result.message).toContain("Unknown action: init")
        expect(result.message).toContain("typescript backend bug")
        expect(result.message).toContain("any { YourAction, }")
        expect(result.message).toContain("--backend rust")
      }
    }))

  it.effect("unknown action with other name has simple message", () =>
    Effect.gen(function*() {
      const result = yield* replayTrace(
        makeTrace("DoSomething"),
        0,
        emptyDriver,
        defaultConfig,
        undefined,
        "test-seed"
      ).pipe(
        Effect.match({
          onFailure: (e) => e,
          onSuccess: () => undefined
        })
      )

      expect(result).toBeInstanceOf(TraceReplayError)
      if (result instanceof TraceReplayError) {
        expect(result.message).toBe("Unknown action: DoSomething")
        expect(result.message).not.toContain("typescript backend bug")
      }
    }))
})

// ---------------------------------------------------------------------------
// T1c: StateMismatchError message contains Expected/Actual + bigint support
// ---------------------------------------------------------------------------

describe("StateMismatchError contains expected/actual in message (T1c)", () => {
  it.effect("message includes Expected and Actual with bigint values", () =>
    Effect.gen(function*() {
      const trace: ItfTrace = {
        vars: ["count", "mbt::actionTaken", "mbt::nondetPicks"],
        states: [
          {
            "#meta": { index: 0 },
            "mbt::actionTaken": "",
            "mbt::nondetPicks": {},
            count: { "#bigint": "0" }
          },
          {
            "#meta": { index: 1 },
            "mbt::actionTaken": "Increment",
            "mbt::nondetPicks": {
              amount: { tag: "Some", value: { "#bigint": "5" } }
            },
            count: { "#bigint": "5" }
          }
        ]
      }

      const mismatchFactory = defineDriver(
        { Increment: { amount: ITFBigInt } },
        () => ({
          Increment: () => Effect.void,
          getState: () => Effect.succeed({ count: 999n })
        })
      )
      const driver = yield* mismatchFactory.create()

      const result = yield* replayTrace(
        trace,
        0,
        driver,
        defaultConfig,
        stateCheck(
          (raw) => Schema.decodeUnknown(Schema.Struct({ count: ITFBigInt }))(raw).pipe(Effect.orDie),
          (spec, impl) => spec.count === impl.count
        ),
        "abc123"
      ).pipe(
        Effect.match({
          onFailure: (e) => e,
          onSuccess: () => undefined
        })
      )

      expect(result).toBeInstanceOf(StateMismatchError)
      if (result instanceof StateMismatchError) {
        expect(result.message).toContain("State mismatch")
        expect(result.message).toContain("Expected:")
        expect(result.message).toContain("Actual:")
        expect(result.message).toContain("abc123")
        // Bigint values should be serialized as "5n" / "999n"
        expect(result.message).toContain("5n")
        expect(result.message).toContain("999n")
      }
    }))
})

// ---------------------------------------------------------------------------
// jsonReplacer
// ---------------------------------------------------------------------------

describe("jsonReplacer", () => {
  it("converts bigint to string with n suffix", () => {
    expect(jsonReplacer("key", 42n)).toBe("42n")
    expect(jsonReplacer("key", 0n)).toBe("0n")
    expect(jsonReplacer("key", -1n)).toBe("-1n")
  })

  it("passes through non-bigint values unchanged", () => {
    expect(jsonReplacer("key", 42)).toBe(42)
    expect(jsonReplacer("key", "hello")).toBe("hello")
    expect(jsonReplacer("key", null)).toBe(null)
    expect(jsonReplacer("key", true)).toBe(true)
  })

  it("works with JSON.stringify for objects containing bigints", () => {
    const obj = { count: 5n, name: "test" }
    const result = JSON.stringify(obj, jsonReplacer)
    expect(result).toBe("{\"count\":\"5n\",\"name\":\"test\"}")
  })
})
