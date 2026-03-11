import { NodeContext } from "@effect/platform-node"
import { describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as path from "node:path"
import { expect } from "vitest"

import { ITFBigInt } from "@firfi/itf-trace-parser/effect"
import { ITFBigInt as ITFBigIntZod } from "@firfi/itf-trace-parser/zod"
import { z } from "zod"

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
          (raw) => Schema.decodeUnknown(CounterStateSchema)(raw).pipe(Effect.orDie),
          (spec, impl) => spec.count === impl.count
        )
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)
      expect(result.seed).toBe("1")
    }).pipe(
      Effect.provide(NodeContext.layer),
      Effect.scoped
    ), { timeout: 30000 })

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
          (raw) => Schema.decodeUnknown(CounterStateSchema)(raw).pipe(Effect.orDie),
          (spec, impl) => spec.count === impl.count
        )
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)
      expect(result.seed).toBe("1")
    }).pipe(
      Effect.provide(NodeContext.layer),
      Effect.scoped
    ), { timeout: 30000 })

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
    }).pipe(
      Effect.provide(NodeContext.layer),
      Effect.scoped
    ), { timeout: 30000 })

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
    }).pipe(
      Effect.provide(NodeContext.layer),
      Effect.scoped
    ), { timeout: 30000 })
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
    expect(steps.length).toBeGreaterThan(0)
    expect(steps[0].action).toBe("Increment")
    expect(typeof steps[0].amount).toBe("bigint")
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

      expect(steps.length).toBeGreaterThan(0)
      expect(steps[0].action).toBe("Increment")
      expect(steps[0].picks).toBeInstanceOf(Map)
      expect(steps[0].picks.has("amount")).toBe(true)
    }).pipe(
      Effect.provide(NodeContext.layer),
      Effect.scoped
    ), { timeout: 30000 })
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
          (raw) => Schema.decodeUnknown(NestedStateSchema)(raw).pipe(Effect.orDie),
          (spec, impl) => spec.count === impl.count
        )
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)
      expect(result.seed).toBe("1")
    }).pipe(
      Effect.provide(NodeContext.layer),
      Effect.scoped
    ), { timeout: 30000 })
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
          (raw) => Schema.decodeUnknown(NestedStateSchema)(raw).pipe(Effect.orDie),
          (spec, impl) => spec.count === impl.count
        )
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)
      expect(result.seed).toBe("1")
    }).pipe(
      Effect.provide(NodeContext.layer),
      Effect.scoped
    ), { timeout: 30000 })
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
    }).pipe(
      Effect.provide(NodeContext.layer),
      Effect.scoped
    ), { timeout: 30000 })
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
