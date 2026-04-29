import { describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"

import { ITFBigInt } from "@firfi/itf-trace-parser/effect"

import { StateMismatchError, TraceReplayError } from "../src/runner/runner.js"
import { checkReplayState, projectState } from "../src/runner/state-check.js"

describe("runner state-check module", () => {
  it("projects state by stripping metadata when no statePath is configured", () => {
    expect(
      projectState(
        {
          "#meta": { index: 1 },
          "mbt::actionTaken": "Increment",
          "mbt::nondetPicks": {},
          "counter_inner::count": { "#bigint": "5" }
        },
        []
      )
    ).toEqual({ "counter_inner::count": { "#bigint": "5" } })
  })

  it("projects state through module-qualified statePath keys", () => {
    expect(
      projectState(
        {
          "multimod_nested::rc::state": {
            count: { "#bigint": "3" },
            label: "incremented"
          }
        },
        ["multimod_nested::rc::state"]
      )
    ).toEqual({
      count: { "#bigint": "3" },
      label: "incremented"
    })
  })

  it.effect("requires getState when stateCheck is provided", () =>
    Effect.gen(function*() {
      const result = yield* checkReplayState<{ readonly count: bigint }, never, never>({
        rawState: { count: { "#bigint": "1" } },
        statePath: [],
        driver: {},
        stateCheck: {
          deserializeState: () => Effect.succeed({ count: 1n }),
          compareState: () => true
        },
        traceIndex: 2,
        stepIndex: 3,
        action: "Increment",
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

  it.effect("formats bigint values in mismatch messages", () =>
    Effect.gen(function*() {
      const result = yield* checkReplayState({
        rawState: { count: { "#bigint": "5" } },
        statePath: [],
        driver: { getState: () => Effect.succeed({ count: 999n }) },
        stateCheck: {
          deserializeState: (raw) => Schema.decodeUnknown(Schema.Struct({ count: ITFBigInt }))(raw).pipe(Effect.orDie),
          compareState: (spec, impl) => spec.count === impl.count
        },
        traceIndex: 0,
        stepIndex: 1,
        action: "Increment",
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
        rawState: { count: { "#bigint": "5" } },
        statePath: [],
        driver,
        stateCheck: {
          deserializeState: (raw) => Schema.decodeUnknown(Schema.Struct({ count: ITFBigInt }))(raw).pipe(Effect.orDie),
          compareState: (spec, impl) => spec.count === impl.count
        },
        traceIndex: 0,
        stepIndex: 1,
        action: "Increment",
        seed: "abc123"
      })
    }))
})
