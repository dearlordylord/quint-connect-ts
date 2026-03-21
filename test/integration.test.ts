import { describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as path from "node:path"
import { expect } from "vitest"

import { ITFBigInt as ITFBigIntZod } from "@firfi/itf-trace-parser/zod"
import { z } from "zod"
import { ITFBigInt } from "../src/itf/schema.js"

import { QuintError } from "../src/cli/quint.js"
import type { Config, Driver, PartialActionMap } from "../src/driver/types.js"
import { defineDriver, stateCheck } from "../src/effect.js"
import { quintRun, TraceReplayError } from "../src/runner/runner.js"
import {
  defineDriver as defineDriverSimple,
  pickFrom,
  run,
  stateCheck as simpleStateCheck,
  StateMismatchError as SimpleStateMismatchError,
  TraceReplayError as SimpleTraceReplayError
} from "../src/simple.js"

const CounterStateSchema = Schema.Struct({
  count: ITFBigInt
})

const specDir = path.resolve(import.meta.dirname, "specs")

const createCounterDriverFactory = () =>
  defineDriver(
    { Increment: { amount: ITFBigInt } },
    () => {
      let count = 0n
      return {
        Increment: ({ amount }) =>
          Effect.sync(() => {
            count += amount
          }),
        getState: () => Effect.succeed({ count })
      }
    }
  )

const createCounterDriverWithoutActions = (): Driver<
  typeof CounterStateSchema.Type,
  never,
  never,
  PartialActionMap
> => ({
  actions: {},
  getState: () => Effect.succeed({ count: 0n })
})

const createStatelessCounterDriverFactory = () =>
  defineDriver(
    { Increment: { amount: ITFBigInt } },
    () => ({
      Increment: () => Effect.void
    })
  )

describe("Integration: counter spec", () => {
  it.effect("replays traces from quint run against a TS driver", () =>
    Effect.gen(function*() {
      const result = yield* quintRun({
        spec: path.join(specDir, "counter.qnt"),
        nTraces: 3,
        maxSamples: 3,
        maxSteps: 5,
        seed: "1",
        driverFactory: createCounterDriverFactory(),
        stateCheck: stateCheck(
          (raw) => Schema.decodeUnknownEffect(CounterStateSchema)(raw).pipe(Effect.orDie),
          (spec, impl) => spec.count === impl.count
        )
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)
      expect(result.seed).toBe("1")
    }), { timeout: 30000 })

  it.effect("replays traces concurrently with concurrency > 1", () =>
    Effect.gen(function*() {
      const result = yield* quintRun({
        spec: path.join(specDir, "counter.qnt"),
        nTraces: 3,
        maxSamples: 3,
        maxSteps: 5,
        seed: "1",
        concurrency: 3,
        driverFactory: createCounterDriverFactory(),
        stateCheck: stateCheck(
          (raw) => Schema.decodeUnknownEffect(CounterStateSchema)(raw).pipe(Effect.orDie),
          (spec, impl) => spec.count === impl.count
        )
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)
      expect(result.seed).toBe("1")
    }), { timeout: 30000 })

  it.effect("replays traces without stateCheck and without getState", () =>
    Effect.gen(function*() {
      const result = yield* quintRun({
        spec: path.join(specDir, "counter.qnt"),
        nTraces: 3,
        maxSamples: 3,
        maxSteps: 5,
        seed: "1",
        driverFactory: createStatelessCounterDriverFactory()
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)
      expect(result.seed).toBe("1")
    }), { timeout: 30000 })

  it.effect("fails with TraceReplayError on unknown action", () =>
    Effect.gen(function*() {
      const result = yield* quintRun({
        spec: path.join(specDir, "counter.qnt"),
        nTraces: 1,
        maxSamples: 2,
        maxSteps: 3,
        seed: "1",
        driverFactory: {
          create: () => Effect.succeed(createCounterDriverWithoutActions())
        }
      }).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => undefined
        })
      )

      expect(result).toBeInstanceOf(TraceReplayError)
      if (result instanceof TraceReplayError) {
        expect(result.message).toContain("Unknown action")
      }
    }), { timeout: 30000 })
})

describe("Integration: raw mode", () => {
  it("simple API raw mode with defineDriver(factory) and pickFrom", { timeout: 30000 }, async () => {
    const steps: Array<{ action: string; amount: bigint | undefined }> = []
    const result = await run({
      spec: path.join(specDir, "counter.qnt"),
      nTraces: 1,
      maxSamples: 2,
      maxSteps: 3,
      seed: "1",
      driver: defineDriverSimple(() => ({
        step: (action, nondetPicks) => {
          const amount = pickFrom(nondetPicks, "amount", ITFBigIntZod)
          steps.push({ action, amount })
        }
      }))
    })

    expect(result.tracesReplayed).toBeGreaterThan(0)
    expect(steps.length).toBeGreaterThan(1)
    // Step 0: TS backend reports "init" placeholder (Rust backend would report actual init action name)
    expect(steps[0].action).toBe("init")
    // Step 1+: actual action names
    expect(steps[1].action).toBe("Increment")
    expect(typeof steps[1].amount).toBe("bigint")
  })

  it.effect("effect-level raw mode with manual Driver step", () =>
    Effect.gen(function*() {
      const steps: Array<{ action: string; picks: ReadonlyMap<string, unknown> }> = []
      yield* quintRun({
        spec: path.join(specDir, "counter.qnt"),
        nTraces: 1,
        maxSamples: 2,
        maxSteps: 3,
        seed: "1",
        driverFactory: {
          create: () => {
            const driver: Driver<unknown, never, never, PartialActionMap> = {
              actions: {},
              step: (action: string, picks: ReadonlyMap<string, unknown>) =>
                Effect.sync(() => {
                  steps.push({ action, picks })
                })
            }
            return Effect.succeed(driver)
          }
        }
      })

      expect(steps.length).toBeGreaterThan(1)
      // Step 0: TS backend reports "init" placeholder
      expect(steps[0].action).toBe("init")
      // Step 1+: actual action names
      expect(steps[1].action).toBe("Increment")
      expect(steps[1].picks).toBeInstanceOf(Map)
      expect(steps[1].picks.has("amount")).toBe(true)
    }), { timeout: 30000 })
})

const NestedStateSchema = Schema.Struct({
  count: ITFBigInt
})

const nestedConfig: Config = {
  statePath: ["routingState"],
  nondetPath: []
}

const createNestedDriverFactory = () =>
  defineDriver(
    { Increment: { amount: ITFBigInt } },
    () => {
      let count = 0n
      return {
        Increment: ({ amount }) =>
          Effect.sync(() => {
            count += amount
          }),
        getState: () => Effect.succeed({ count }),
        config: () => nestedConfig
      }
    }
  )

describe("Integration: nested state spec with statePath", () => {
  it.effect("replays traces using statePath to extract nested state", () =>
    Effect.gen(function*() {
      const result = yield* quintRun({
        spec: path.join(specDir, "nested.qnt"),
        nTraces: 3,
        maxSamples: 3,
        maxSteps: 5,
        seed: "1",
        driverFactory: createNestedDriverFactory(),
        stateCheck: stateCheck(
          (raw) => Schema.decodeUnknownEffect(NestedStateSchema)(raw).pipe(Effect.orDie),
          (spec, impl) => spec.count === impl.count
        )
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)
      expect(result.seed).toBe("1")
    }), { timeout: 30000 })
})

// ---------------------------------------------------------------------------
// Multi-module spec: module-qualified state keys
// ---------------------------------------------------------------------------

const MultimodStateSchema = Schema.Struct({
  "multimod::ctr::count": ITFBigInt
})

describe("Integration: multi-module spec with qualified state keys", () => {
  it.effect("instance state keys are fully qualified (mainModule::alias::var)", () =>
    Effect.gen(function*() {
      const rawStates: Array<Record<string, unknown>> = []
      const actions: Array<string> = []

      yield* quintRun({
        spec: path.join(specDir, "multimod.qnt"),
        main: "multimod",
        nTraces: 1,
        maxSamples: 2,
        maxSteps: 3,
        seed: "1",
        driverFactory: {
          create: () => {
            const driver: Driver<unknown, never, never, PartialActionMap> = {
              actions: {},
              step: (action, _nondetPicks) =>
                Effect.sync(() => {
                  actions.push(action)
                }),
              getState: () => Effect.succeed({})
            }
            return Effect.succeed(driver)
          }
        },
        stateCheck: stateCheck(
          (raw) => {
            if (typeof raw === "object" && raw !== null) {
              rawStates.push({ ...raw as Record<string, unknown> })
            }
            return Effect.succeed(raw)
          },
          () => true
        )
      })

      expect(rawStates.length).toBeGreaterThan(0)

      const firstState = rawStates[0]
      const keys = Object.keys(firstState)
      // Metadata should be stripped
      expect(keys.some(k => k === "#meta" || k.startsWith("mbt::"))).toBe(false)
      // Instance state keys are fully qualified: "mainModule::alias::variable"
      expect(keys).toContain("multimod::ctr::count")
      // Actions are NOT qualified
      expect(actions.length).toBeGreaterThan(1)
      // Step 0: TS backend reports "init" placeholder
      expect(actions[0]).toBe("init")
      // Step 1+: actual action names
      expect(actions[1]).toBe("Increment")
    }), { timeout: 30000 })

  it.effect("full replay with state check using qualified keys", () =>
    Effect.gen(function*() {
      const factory = defineDriver(
        { Increment: { amount: ITFBigInt } },
        () => {
          let count = 0n
          return {
            Increment: ({ amount }) =>
              Effect.sync(() => {
                count += amount
              }),
            getState: () => Effect.succeed({ "multimod::ctr::count": count })
          }
        }
      )

      const result = yield* quintRun({
        spec: path.join(specDir, "multimod.qnt"),
        main: "multimod",
        nTraces: 3,
        maxSamples: 3,
        maxSteps: 5,
        seed: "1",
        driverFactory: factory,
        stateCheck: stateCheck(
          (raw) => Schema.decodeUnknownEffect(MultimodStateSchema)(raw).pipe(Effect.orDie),
          (spec, impl) => spec["multimod::ctr::count"] === impl["multimod::ctr::count"]
        )
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)
    }), { timeout: 30000 })
})

// ---------------------------------------------------------------------------
// statePath with module-qualified keys (mirrors Rust quint-connect pattern)
// ---------------------------------------------------------------------------

const MultimodNestedInnerSchema = Schema.Struct({
  count: ITFBigInt,
  label: Schema.String
})

describe("Integration: statePath through qualified key", () => {
  it.effect("statePath extracts inner record from qualified key", () =>
    Effect.gen(function*() {
      const rawStates: Array<Record<string, unknown>> = []

      const factory = defineDriver(
        { Increment: { amount: ITFBigInt } },
        () => {
          let count = 0n
          let label = "start"
          return {
            Increment: ({ amount }) =>
              Effect.sync(() => {
                count += amount
                label = "incremented"
              }),
            getState: () => Effect.succeed({ count, label }),
            config: () => ({ statePath: ["multimod_nested::rc::state"] })
          }
        }
      )

      const result = yield* quintRun({
        spec: path.join(specDir, "multimod_nested.qnt"),
        main: "multimod_nested",
        nTraces: 3,
        maxSamples: 3,
        maxSteps: 5,
        seed: "1",
        driverFactory: factory,
        stateCheck: stateCheck(
          (raw) => {
            if (typeof raw === "object" && raw !== null) {
              rawStates.push({ ...raw as Record<string, unknown> })
            }
            return Schema.decodeUnknownEffect(MultimodNestedInnerSchema)(raw).pipe(Effect.orDie)
          },
          (spec, impl) => spec.count === impl.count
        )
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)

      // deserializeState should receive inner record without qualified keys
      expect(rawStates.length).toBeGreaterThan(0)
      const keys = Object.keys(rawStates[0])
      expect(keys).toContain("count")
      expect(keys).toContain("label")
      expect(keys.some(k => k.includes("::"))).toBe(false)
    }), { timeout: 30000 })
})

const createPartialConfigDriverFactory = () =>
  defineDriver(
    { Increment: { amount: ITFBigInt } },
    () => {
      let count = 0n
      return {
        Increment: ({ amount }) =>
          Effect.sync(() => {
            count += amount
          }),
        getState: () => Effect.succeed({ count }),
        config: () => ({ statePath: ["routingState"] })
      }
    }
  )

describe("Integration: partial config", () => {
  it.effect("works with config that only sets statePath (no nondetPath)", () =>
    Effect.gen(function*() {
      const result = yield* quintRun({
        spec: path.join(specDir, "nested.qnt"),
        nTraces: 3,
        maxSamples: 3,
        maxSteps: 5,
        seed: "1",
        driverFactory: createPartialConfigDriverFactory(),
        stateCheck: stateCheck(
          (raw) => Schema.decodeUnknownEffect(NestedStateSchema)(raw).pipe(Effect.orDie),
          (spec, impl) => spec.count === impl.count
        )
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)
      expect(result.seed).toBe("1")
    }), { timeout: 30000 })
})

describe("Integration: QuintError includes stderr", () => {
  it.effect("includes stderr in error message for nonexistent spec", () =>
    Effect.gen(function*() {
      const result = yield* quintRun({
        spec: path.join(specDir, "nonexistent.qnt"),
        nTraces: 1,
        maxSteps: 3,
        seed: "1",
        driverFactory: createStatelessCounterDriverFactory()
      }).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => undefined
        })
      )

      expect(result).toBeInstanceOf(QuintError)
      if (result instanceof QuintError) {
        expect(result.message).toContain("quint run failed with exit code")
        expect(result.message.length).toBeGreaterThan("quint run failed with exit code 1".length)
      }
    }), { timeout: 30000 })
})

describe("Simple API: error unwrapping", () => {
  it("TraceReplayError instanceof works after run() rejects", { timeout: 30000 }, async () => {
    try {
      await run({
        spec: path.join(specDir, "counter.qnt"),
        nTraces: 1,
        maxSamples: 2,
        maxSteps: 3,
        seed: "1",
        driver: () => ({
          actions: {}
        })
      })
      expect.unreachable("run() should have thrown")
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(SimpleTraceReplayError)
      if (e instanceof SimpleTraceReplayError) {
        expect(e._tag).toBe("TraceReplayError")
        expect(e.message).toContain("Unknown action")
      }
    }
  })

  it("StateMismatchError instanceof works after run() rejects", { timeout: 30000 }, async () => {
    try {
      await run({
        spec: path.join(specDir, "counter.qnt"),
        nTraces: 1,
        maxSamples: 2,
        maxSteps: 3,
        seed: "1",
        driver: defineDriverSimple(
          { Increment: { amount: ITFBigIntZod } },
          () => ({
            Increment: () => {
              // intentionally do nothing — state will mismatch
            },
            getState: () => ({ count: 999n })
          })
        ),
        stateCheck: simpleStateCheck(
          (raw) => z.object({ count: ITFBigIntZod }).parse(raw),
          (spec, impl) => spec.count === impl.count
        )
      })
      expect.unreachable("run() should have thrown")
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(SimpleStateMismatchError)
      if (e instanceof SimpleStateMismatchError) {
        expect(e._tag).toBe("StateMismatchError")
        expect(e.message).toContain("State mismatch")
      }
    }
  })

  it("handler throw is wrapped in TraceReplayError", { timeout: 30000 }, async () => {
    try {
      await run({
        spec: path.join(specDir, "counter.qnt"),
        nTraces: 1,
        maxSamples: 2,
        maxSteps: 3,
        seed: "1",
        driver: defineDriverSimple(
          { Increment: { amount: ITFBigIntZod } },
          () => ({
            Increment: () => {
              throw new Error("handler crash")
            }
          })
        )
      })
      expect.unreachable("run() should have thrown")
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(SimpleTraceReplayError)
      if (e instanceof SimpleTraceReplayError) {
        expect(e._tag).toBe("TraceReplayError")
        expect(e.message).toContain("handler crash")
        expect(e.traceIndex).toBeDefined()
        expect(e.stepIndex).toBeDefined()
        expect(e.action).toBeDefined()
      }
    }
  })
})
