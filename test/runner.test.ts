import { describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"

import { ITFBigInt } from "../src/itf/schema.js"

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
// Module-qualified state keys (multi-module specs)
// ---------------------------------------------------------------------------

describe("stripMetadata preserves module-qualified state keys", () => {
  it("keeps keys with :: that are not mbt::", () => {
    const raw = {
      "#meta": { index: 1 },
      "mbt::actionTaken": "Increment",
      "mbt::nondetPicks": { amount: 1 },
      "counter_inner::count": 42
    }
    const result = stripMetadata(raw)
    expect(result).toEqual({ "counter_inner::count": 42 })
  })

  it("keeps deeply qualified keys", () => {
    const raw = {
      "#meta": { index: 1 },
      "mbt::actionTaken": "Increment",
      "mbt::nondetPicks": {},
      "outer::inner::count": 42,
      "other_module::data": "hello"
    }
    const result = stripMetadata(raw)
    expect(result).toEqual({
      "outer::inner::count": 42,
      "other_module::data": "hello"
    })
  })
})

describe("replayTrace with module-qualified state keys", () => {
  it.effect("deserializeState receives module-qualified keys", () =>
    Effect.gen(function*() {
      const receivedRaws: Array<unknown> = []

      const trace: ItfTrace = {
        vars: ["counter_inner::count", "mbt::actionTaken", "mbt::nondetPicks"],
        states: [
          {
            "#meta": { index: 0 },
            "mbt::actionTaken": "",
            "mbt::nondetPicks": {},
            "counter_inner::count": { "#bigint": "0" }
          },
          {
            "#meta": { index: 1 },
            "mbt::actionTaken": "Increment",
            "mbt::nondetPicks": {
              amount: { tag: "Some", value: { "#bigint": "5" } }
            },
            "counter_inner::count": { "#bigint": "5" }
          }
        ]
      }

      const factory = defineDriver(
        { Increment: { amount: ITFBigInt } },
        () => ({
          Increment: () => Effect.void,
          getState: () => Effect.succeed({ "counter_inner::count": 5n })
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
            return Schema.decodeUnknownEffect(
              Schema.Struct({ "counter_inner::count": ITFBigInt })
            )(raw).pipe(Effect.orDie)
          },
          (spec, impl) => spec["counter_inner::count"] === impl["counter_inner::count"]
        ),
        "test-seed"
      )

      expect(receivedRaws.length).toBe(1)
      const received = receivedRaws[0] as Record<string, unknown>
      expect(Object.keys(received)).toContain("counter_inner::count")
      expect(Object.keys(received)).not.toContain("#meta")
      expect(Object.keys(received)).not.toContain("mbt::actionTaken")
      expect(Object.keys(received)).not.toContain("mbt::nondetPicks")
    }))

  it.effect("state mismatch error works with module-qualified keys", () =>
    Effect.gen(function*() {
      const trace: ItfTrace = {
        vars: ["mod::x", "mod::y", "mbt::actionTaken", "mbt::nondetPicks"],
        states: [
          {
            "#meta": { index: 0 },
            "mbt::actionTaken": "",
            "mbt::nondetPicks": {},
            "mod::x": { "#bigint": "0" },
            "mod::y": { "#bigint": "0" }
          },
          {
            "#meta": { index: 1 },
            "mbt::actionTaken": "Step",
            "mbt::nondetPicks": {},
            "mod::x": { "#bigint": "1" },
            "mod::y": { "#bigint": "2" }
          }
        ]
      }

      const ModState = Schema.Struct({ "mod::x": ITFBigInt, "mod::y": ITFBigInt })

      const factory = defineDriver(
        { Step: {} },
        () => ({
          Step: () => Effect.void,
          getState: () => Effect.succeed({ "mod::x": 1n, "mod::y": 999n })
        })
      )
      const driver = yield* factory.create()

      const result = yield* replayTrace(
        trace,
        0,
        driver,
        defaultConfig,
        stateCheck(
          (raw) => Schema.decodeUnknownEffect(ModState)(raw).pipe(Effect.orDie),
          (spec, impl) => spec["mod::x"] === impl["mod::x"] && spec["mod::y"] === impl["mod::y"]
        ),
        "test-seed"
      ).pipe(
        Effect.match({
          onFailure: (e) => e,
          onSuccess: () => undefined
        })
      )

      expect(result).toBeInstanceOf(StateMismatchError)
      if (result instanceof StateMismatchError) {
        expect(result.message).toContain("State mismatch")
        expect(result.message).toContain("2n")
        expect(result.message).toContain("999n")
      }
    }))
})

// ---------------------------------------------------------------------------
// statePath with module-qualified keys (Rust quint-connect pattern)
// ---------------------------------------------------------------------------

describe("replayTrace with statePath through qualified key", () => {
  it.effect("statePath navigates through qualified key to inner record", () =>
    Effect.gen(function*() {
      const receivedRaws: Array<unknown> = []

      const trace: ItfTrace = {
        vars: ["multimod_nested::rc::state", "mbt::actionTaken", "mbt::nondetPicks"],
        states: [
          {
            "#meta": { index: 0 },
            "mbt::actionTaken": "",
            "mbt::nondetPicks": {},
            "multimod_nested::rc::state": {
              count: { "#bigint": "0" },
              label: "start"
            }
          },
          {
            "#meta": { index: 1 },
            "mbt::actionTaken": "Increment",
            "mbt::nondetPicks": {
              amount: { tag: "Some", value: { "#bigint": "3" } }
            },
            "multimod_nested::rc::state": {
              count: { "#bigint": "3" },
              label: "incremented"
            }
          }
        ]
      }

      const factory = defineDriver(
        { Increment: { amount: ITFBigInt } },
        () => ({
          Increment: () => Effect.void,
          getState: () => Effect.succeed({ count: 3n, label: "incremented" }),
          config: () => ({ statePath: ["multimod_nested::rc::state"] })
        })
      )
      const driver = yield* factory.create()
      const config = { ...defaultConfig, ...driver.config?.() }

      yield* replayTrace(
        trace,
        0,
        driver,
        config,
        stateCheck(
          (raw) => {
            receivedRaws.push(raw)
            return Schema.decodeUnknownEffect(
              Schema.Struct({ count: ITFBigInt, label: Schema.String })
            )(raw).pipe(Effect.orDie)
          },
          (spec, impl) => spec.count === impl.count && spec.label === impl.label
        ),
        "test-seed"
      )

      expect(receivedRaws.length).toBe(1)
      const received = receivedRaws[0] as Record<string, unknown>
      // deserializeState should receive the inner record, not the qualified key
      expect(Object.keys(received)).toContain("count")
      expect(Object.keys(received)).toContain("label")
      expect(Object.keys(received).some(k => k.includes("::"))).toBe(false)
    }))
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
            return Schema.decodeUnknownEffect(Schema.Struct({ count: ITFBigInt }))(raw).pipe(Effect.orDie)
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
          (raw) => Schema.decodeUnknownEffect(Schema.Struct({ count: ITFBigInt }))(raw).pipe(Effect.orDie),
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

// ---------------------------------------------------------------------------
// onInit hook
// ---------------------------------------------------------------------------

describe("replayTrace onInit hook", () => {
  it.effect("calls onInit with stripped state at step 0", () =>
    Effect.gen(function*() {
      const receivedInit: Array<unknown> = []

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

      const factory = defineDriver(
        { Increment: { amount: ITFBigInt } },
        () => ({
          Increment: () => Effect.void,
          getState: () => Effect.succeed({ count: 5n }),
          onInit: (rawState: unknown) =>
            Effect.sync(() => {
              receivedInit.push(rawState)
            })
        })
      )
      const driver = yield* factory.create()

      yield* replayTrace(
        trace,
        0,
        driver,
        defaultConfig,
        stateCheck(
          (raw) => Schema.decodeUnknownEffect(Schema.Struct({ count: ITFBigInt }))(raw).pipe(Effect.orDie),
          (spec, impl) => spec.count === impl.count
        ),
        "test-seed"
      )

      expect(receivedInit.length).toBe(1)
      const received = receivedInit[0] as Record<string, unknown>
      // Should receive stripped state (no metadata)
      expect(Object.keys(received)).toContain("count")
      expect(Object.keys(received)).not.toContain("#meta")
      expect(Object.keys(received)).not.toContain("mbt::actionTaken")
      expect(Object.keys(received)).not.toContain("mbt::nondetPicks")
    }))

  it.effect("onInit receives statePath-resolved state", () =>
    Effect.gen(function*() {
      const receivedInit: Array<unknown> = []

      const trace: ItfTrace = {
        vars: ["nested::state", "mbt::actionTaken", "mbt::nondetPicks"],
        states: [
          {
            "#meta": { index: 0 },
            "mbt::actionTaken": "",
            "mbt::nondetPicks": {},
            "nested::state": { count: { "#bigint": "0" }, label: "init" }
          },
          {
            "#meta": { index: 1 },
            "mbt::actionTaken": "Step",
            "mbt::nondetPicks": {},
            "nested::state": { count: { "#bigint": "1" }, label: "stepped" }
          }
        ]
      }

      const factory = defineDriver(
        { Step: {} },
        () => ({
          Step: () => Effect.void,
          getState: () => Effect.succeed({ count: 1n, label: "stepped" }),
          config: () => ({ statePath: ["nested::state"] }),
          onInit: (rawState: unknown) =>
            Effect.sync(() => {
              receivedInit.push(rawState)
            })
        })
      )
      const driver = yield* factory.create()
      const config = { ...defaultConfig, ...driver.config?.() }

      yield* replayTrace(
        trace,
        0,
        driver,
        config,
        stateCheck(
          (raw) =>
            Schema.decodeUnknownEffect(
              Schema.Struct({ count: ITFBigInt, label: Schema.String })
            )(raw).pipe(Effect.orDie),
          (spec, impl) => spec.count === impl.count && spec.label === impl.label
        ),
        "test-seed"
      )

      expect(receivedInit.length).toBe(1)
      const received = receivedInit[0] as Record<string, unknown>
      // Should receive the inner record via statePath, not the qualified key
      expect(Object.keys(received)).toContain("count")
      expect(Object.keys(received)).toContain("label")
      expect(Object.keys(received).some(k => k.includes("::"))).toBe(false)
    }))

  it.effect("skips onInit when not provided", () =>
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

      const factory = defineDriver(
        { Increment: { amount: ITFBigInt } },
        () => ({
          Increment: () => Effect.void,
          getState: () => Effect.succeed({ count: 5n })
        })
      )
      const driver = yield* factory.create()

      // Should not throw — onInit is optional
      yield* replayTrace(
        trace,
        0,
        driver,
        defaultConfig,
        stateCheck(
          (raw) => Schema.decodeUnknownEffect(Schema.Struct({ count: ITFBigInt }))(raw).pipe(Effect.orDie),
          (spec, impl) => spec.count === impl.count
        ),
        "test-seed"
      )
    }))
})
