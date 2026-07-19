import { describe, it } from "@effect/vitest"
import { Context, Effect, Layer, Schema } from "effect"
import { expect } from "vitest"

import type { ActionMap, Driver } from "../src/driver/types.js"
import type { ItfTrace } from "../src/itf/schema.js"
import { decodeReplayStep } from "../src/runner/replay-actions.js"
import type { StateMismatchError } from "../src/runner/replay-errors.js"
import { TraceReplayError } from "../src/runner/replay-errors.js"
import { replayTrace } from "../src/runner/runner.js"
import { checkReplayState } from "../src/runner/state-check.js"

class StateDecodeError extends Schema.TaggedError<StateDecodeError>()("StateDecodeError", {
  message: Schema.String
}) {}

class DriverError extends Schema.TaggedError<DriverError>()("DriverError", {
  message: Schema.String
}) {}

class StateDecodeService extends Context.Tag("test/StateDecodeService")<
  StateDecodeService,
  { readonly decode: (raw: unknown) => Effect.Effect<{ readonly count: bigint }, StateDecodeError> }
>() {}

describe("localized replay decoding", () => {
  it.effect("decodes action, picks, and projected state into one replay step", () =>
    Effect.gen(function*() {
      const step = yield* decodeReplayStep(
        {
          envelope: {
            choice: { tag: "Move", value: { from: "a", to: "b" } },
            state: { position: "b" }
          }
        },
        { nondetPath: ["envelope", "choice"], statePath: ["envelope", "state"] },
        { traceIndex: 3, stepIndex: 4 }
      )

      expect(step).toEqual({
        action: "Move",
        nondetPicks: new Map([
          ["from", { tag: "Some", value: "a" }],
          ["to", { tag: "Some", value: "b" }]
        ]),
        specState: { position: "b" }
      })
    }))

  it.effect("reports a missing required state path with replay context", () =>
    Effect.gen(function*() {
      const error = yield* decodeReplayStep(
        { choice: { tag: "Move", value: {} } },
        { nondetPath: ["choice"], statePath: ["missing", "state"] },
        { traceIndex: 5, stepIndex: 6 }
      ).pipe(Effect.flip)

      expect(error).toMatchObject({ traceIndex: 5, stepIndex: 6, action: "Move" })
      expect(error.message).toContain("Expected state at path missing.state")
    }))

  it.effect("turns typed state deserialization failures into contextual replay errors", () =>
    Effect.gen(function*() {
      const cause = new StateDecodeError({ message: "invalid counter state" })
      const error = yield* checkReplayState({
        step: { action: "Increment", nondetPicks: new Map(), specState: { count: "invalid" } },
        driver: { getState: () => Effect.succeed({ count: 1n }) },
        stateCheck: {
          deserializeState: () => Effect.fail(cause),
          compareState: () => true
        },
        context: { traceIndex: 7, stepIndex: 8, action: "Increment" },
        seed: "seed"
      }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(TraceReplayError)
      expect(error).toMatchObject({ traceIndex: 7, stepIndex: 8, action: "Increment", cause })
      expect(error.message).toContain("Failed to deserialize spec state")
    }))

  it.effect("preserves state-deserializer service requirements", () =>
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
      Effect.provide(Layer.succeed(StateDecodeService, { decode: () => Effect.succeed({ count: 2n }) }))
    ))

  it.effect("preserves driver failures while wrapping state-decoder failures", () => {
    const program: Effect.Effect<
      void,
      DriverError | StateMismatchError | TraceReplayError,
      StateDecodeService
    > = checkReplayState({
      step: { action: "Increment", nondetPicks: new Map(), specState: { count: { "#bigint": "2" } } },
      driver: { getState: () => Effect.fail(new DriverError({ message: "driver read failed" })) },
      stateCheck: {
        deserializeState: (raw) =>
          Effect.gen(function*() {
            const service = yield* StateDecodeService
            return yield* service.decode(raw)
          }),
        compareState: () => true
      },
      context: { traceIndex: 0, stepIndex: 1, action: "Increment" },
      seed: "seed"
    })

    return Effect.gen(function*() {
      const error = yield* program.pipe(
        Effect.provideService(StateDecodeService, { decode: () => Effect.succeed({ count: 2n }) }),
        Effect.flip
      )
      expect(error).toBeInstanceOf(DriverError)
    })
  })

  it.effect("does not require state projection when state checking is disabled", () =>
    Effect.gen(function*() {
      let dispatched = false
      const trace: ItfTrace = {
        vars: ["mbt::actionTaken", "mbt::nondetPicks"],
        states: [{ "mbt::actionTaken": "Increment", "mbt::nondetPicks": {} }]
      }
      const driver: Driver<unknown, never, never, ActionMap<never, never>> = {
        actions: {
          Increment: {
            picks: Schema.Struct({}),
            handler: () =>
              Effect.sync(() => {
                dispatched = true
              })
          }
        }
      }

      yield* replayTrace(trace, 0, driver, { statePath: ["missing"] }, undefined, "seed")
      expect(dispatched).toBe(true)
    }))
})
