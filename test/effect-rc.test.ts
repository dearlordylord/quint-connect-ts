import { describe, it } from "@effect/vitest"
import { Context, Effect, Layer, Schema } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect } from "vitest"

import { QuintError, QuintNotFoundError } from "../src/cli/errors.js"
import { defineDriver, quintRun, stateCheck } from "../src/effect.js"
import { ITFBigInt } from "../src/itf/schema.js"
import { NoTracesError, StateMismatchError, TraceReplayError } from "../src/runner/replay-errors.js"

class ReplayService extends Context.Service<ReplayService, {
  readonly record: (amount: string) => void
}>()("test/ReplayService") {}

class StateDecodeError extends Schema.TaggedError<StateDecodeError>()("StateDecodeError", {
  message: Schema.String
}) {}

class StateDecodeService extends Context.Service<StateDecodeService, {
  readonly decode: (raw: unknown) => Effect.Effect<{ readonly count: bigint }, StateDecodeError>
}>()("test/StateDecodeService") {}

const withTraceDir = <A, E, R>(use: (traceDir: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "quint-connect-rc-"))),
    use,
    (traceDir) => Effect.promise(() => rm(traceDir, { recursive: true, force: true }))
  )

describe("Effect 4 RC compatibility", () => {
  it.effect("preserves driver service requirements through quintRun", () =>
    Effect.gen(function*() {
      const recorded: Array<string> = []
      const driverFactory = defineDriver(
        { init: {}, Increment: { amount: ITFBigInt } },
        () => {
          let count = 0n
          return {
            init: () => Effect.void,
            Increment: ({ amount }) =>
              Effect.gen(function*() {
                const service = yield* ReplayService
                count += amount
                service.record(String(amount))
              }),
            getState: () => Effect.succeed({ count })
          }
        }
      )

      const result = yield* withTraceDir((traceDir) =>
        quintRun({
          spec: join(import.meta.dirname, "specs", "counter.qnt"),
          traceDir,
          driverFactory,
          seed: "7",
          nTraces: 1,
          maxSamples: 1,
          maxSteps: 1,
          stateCheck: stateCheck(
            (raw) =>
              Effect.gen(function*() {
                const service = yield* StateDecodeService
                return yield* service.decode(raw)
              }),
            (spec, impl) => spec.count === impl.count
          )
        })
      ).pipe(
        Effect.provide(Layer.succeed(
          ReplayService,
          ReplayService.of({
            record: (amount) => recorded.push(amount)
          })
        )),
        Effect.provide(Layer.succeed(
          StateDecodeService,
          StateDecodeService.of({
            decode: (raw) => Schema.decodeUnknownEffect(Schema.Struct({ count: ITFBigInt }))(raw).pipe(Effect.orDie)
          })
        ))
      )

      expect(result).toEqual({ tracesReplayed: 1, seed: "7" })
      expect(recorded).toHaveLength(1)
    }))

  it.effect("supports catchTag and preserves fields for every public typed error", () =>
    Effect.gen(function*() {
      const quint = yield* Effect.fail(new QuintError({ message: "quint", stderr: "stderr", exitCode: 2 })).pipe(
        Effect.catchTag("QuintError", Effect.succeed)
      )
      const notFound = yield* Effect.fail(new QuintNotFoundError({ message: "missing" })).pipe(
        Effect.catchTag("QuintNotFoundError", Effect.succeed)
      )
      const replay = yield* Effect.fail(
        new TraceReplayError({
          message: "replay",
          traceIndex: 1,
          stepIndex: 2,
          action: "Increment",
          cause: "handler"
        })
      ).pipe(Effect.catchTag("TraceReplayError", Effect.succeed))
      const mismatch = yield* Effect.fail(
        new StateMismatchError({
          message: "mismatch",
          traceIndex: 3,
          stepIndex: 4,
          expected: { count: 1 },
          actual: { count: 2 }
        })
      ).pipe(Effect.catchTag("StateMismatchError", Effect.succeed))
      const noTraces = yield* Effect.fail(new NoTracesError({ message: "none" })).pipe(
        Effect.catchTag("NoTracesError", Effect.succeed)
      )

      expect(quint).toMatchObject({ _tag: "QuintError", message: "quint", stderr: "stderr", exitCode: 2 })
      expect(notFound).toMatchObject({ _tag: "QuintNotFoundError", message: "missing" })
      expect(replay).toMatchObject({
        _tag: "TraceReplayError",
        traceIndex: 1,
        stepIndex: 2,
        action: "Increment",
        cause: "handler"
      })
      expect(mismatch).toMatchObject({
        _tag: "StateMismatchError",
        traceIndex: 3,
        stepIndex: 4,
        expected: { count: 1 },
        actual: { count: 2 },
        showDiff: true
      })
      expect(noTraces).toMatchObject({ _tag: "NoTracesError", message: "none" })
    }))
})
