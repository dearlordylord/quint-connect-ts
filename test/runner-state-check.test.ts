import { describe, it } from "@effect/vitest"
import { Context, Effect, Layer, Schema } from "effect"
import { expect } from "vitest"

import { ITFBigInt } from "@firfi/itf-trace-parser/effect"

import { StateMismatchError, TraceReplayError } from "../src/runner/runner.js"
import { checkReplayState } from "../src/runner/state-check.js"

class StateDecodeError extends Schema.TaggedErrorClass<StateDecodeError>()("StateDecodeError", {
  message: Schema.String
}) {}

class StateDecodeService extends Context.Service<StateDecodeService, {
  readonly decode: (raw: unknown) => Effect.Effect<{ readonly count: bigint }, StateDecodeError>
}>()("test/StateDecodeService") {}

describe("runner state-check module", () => {
  it.effect("requires getState when stateCheck is provided", () =>
    Effect.gen(function*() {
      const result = yield* checkReplayState<{ readonly count: bigint }, never, never>({
        step: { action: "Increment", nondetPicks: new Map(), specState: { count: { "#bigint": "1" } } },
        driver: {},
        stateCheck: {
          deserializeState: () => Effect.succeed({ count: 1n }),
          compareState: () => true
        },
        context: { traceIndex: 2, stepIndex: 3, action: "Increment" },
        seed: "seed"
      }).pipe(
        Effect.match({
          onFailure: (e) => e,
          onSuccess: () => undefined
        })
      )

      expect(result).toBeInstanceOf(TraceReplayError)
      if (result instanceof TraceReplayError) {
        expect(result.message).toBe(
          "stateCheck is provided but driver.getState is not defined; getState is required when stateCheck is provided"
        )
        expect(result.traceIndex).toBe(2)
        expect(result.stepIndex).toBe(3)
        expect(result.action).toBe("Increment")
      }
    }))

  it.effect("wraps typed state deserialization failures with replay context", () =>
    Effect.gen(function*() {
      const decodeError = new StateDecodeError({ message: "invalid counter state" })
      const result = yield* checkReplayState({
        step: { action: "Increment", nondetPicks: new Map(), specState: { count: "invalid" } },
        driver: { getState: () => Effect.succeed({ count: 1n }) },
        stateCheck: {
          deserializeState: () => Effect.fail(decodeError),
          compareState: () => true
        },
        context: { traceIndex: 7, stepIndex: 8, action: "Increment" },
        seed: "seed"
      }).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => undefined
        })
      )

      expect(result).toBeInstanceOf(TraceReplayError)
      if (result instanceof TraceReplayError) {
        expect(result).toMatchObject({ traceIndex: 7, stepIndex: 8, action: "Increment" })
        expect(result.message).toContain("Failed to deserialize spec state")
        expect(result.cause).toBe(decodeError)
      }
    }))

  it.effect("reports state deserialization defects as typed replay failures", () =>
    Effect.gen(function*() {
      const defect = new Error("state decoder defect")
      const result = yield* checkReplayState({
        step: { action: "Increment", nondetPicks: new Map(), specState: { count: "invalid" } },
        driver: { getState: () => Effect.succeed({ count: 1n }) },
        stateCheck: {
          deserializeState: () => Effect.die(defect),
          compareState: () => true
        },
        context: { traceIndex: 2, stepIndex: 3, action: "Increment" },
        seed: "seed"
      }).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => undefined
        })
      )

      expect(result).toBeInstanceOf(TraceReplayError)
      if (result instanceof TraceReplayError) {
        expect(result).toMatchObject({ traceIndex: 2, stepIndex: 3, action: "Increment" })
        expect(result.cause).toBe(defect)
      }
    }))

  it.effect("preserves state deserializer service requirements", () =>
    checkReplayState({
      step: { action: "Increment", nondetPicks: new Map(), specState: { count: { "#bigint": "2" } } },
      driver: { getState: () => Effect.succeed({ count: 2n }) },
      stateCheck: {
        deserializeState: (raw) =>
          Effect.gen(function*() {
            const service = yield* StateDecodeService
            return yield* service.decode(raw)
          }),
        compareState: (spec, impl) => spec.count === impl.count
      },
      context: { traceIndex: 0, stepIndex: 1, action: "Increment" },
      seed: "seed"
    }).pipe(
      Effect.provide(Layer.succeed(
        StateDecodeService,
        StateDecodeService.of({
          decode: () => Effect.succeed({ count: 2n })
        })
      ))
    ))

  it.effect("formats bigint values in mismatch messages", () =>
    Effect.gen(function*() {
      const result = yield* checkReplayState({
        step: { action: "Increment", nondetPicks: new Map(), specState: { count: { "#bigint": "5" } } },
        driver: { getState: () => Effect.succeed({ count: 999n }) },
        stateCheck: {
          deserializeState: (raw) =>
            Schema.decodeUnknownEffect(Schema.Struct({ count: ITFBigInt }))(raw).pipe(Effect.orDie),
          compareState: (spec, impl) => spec.count === impl.count
        },
        context: { traceIndex: 0, stepIndex: 1, action: "Increment" },
        seed: "abc123"
      }).pipe(
        Effect.match({
          onFailure: (e) => e,
          onSuccess: () => undefined
        })
      )

      expect(result).toBeInstanceOf(StateMismatchError)
      if (result instanceof StateMismatchError) {
        expect(result.message).toContain("State mismatch at trace 0, step 1")
        expect(result.message).toContain("abc123")
        expect(result.message).toContain("5n")
        expect(result.message).toContain("999n")
      }
    }))

  it.effect("preserves the driver receiver when reading implementation state", () =>
    Effect.gen(function*() {
      const driver = {
        count: 5n,
        getState() {
          return Effect.succeed({ count: this.count })
        }
      }

      yield* checkReplayState({
        step: { action: "Increment", nondetPicks: new Map(), specState: { count: { "#bigint": "5" } } },
        driver,
        stateCheck: {
          deserializeState: (raw) =>
            Schema.decodeUnknownEffect(Schema.Struct({ count: ITFBigInt }))(raw).pipe(Effect.orDie),
          compareState: (spec, impl) => spec.count === impl.count
        },
        context: { traceIndex: 0, stepIndex: 1, action: "Increment" },
        seed: "abc123"
      })
    }))
})
