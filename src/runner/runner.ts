import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect, Predicate, Schema } from "effect"
import type { QuintError, QuintNotFoundError, RunOptions } from "../cli/quint.js"
import { generateTraces } from "../cli/quint.js"
import type { Config, Driver, DriverFactory, StateComparator } from "../driver/types.js"
import { defaultConfig } from "../driver/types.js"
import type { ItfTrace, MbtMeta } from "../itf/schema.js"
import { MbtMeta as MbtMetaSchema } from "../itf/schema.js"

export class StateMismatchError extends Schema.TaggedError<StateMismatchError>()("StateMismatchError", {
  message: Schema.String,
  traceIndex: Schema.Number,
  stepIndex: Schema.Number,
  expected: Schema.Unknown,
  actual: Schema.Unknown
}) {}

export class TraceReplayError extends Schema.TaggedError<TraceReplayError>()("TraceReplayError", {
  message: Schema.String,
  traceIndex: Schema.Number,
  stepIndex: Schema.Number,
  action: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}

export class NoTracesError extends Schema.TaggedError<NoTracesError>()("NoTracesError", {
  message: Schema.String
}) {}

const extractMbtMeta = (
  state: { readonly [key: string]: unknown },
  traceIndex: number,
  stepIndex: number
): Effect.Effect<MbtMeta, TraceReplayError> =>
  Effect.mapError(
    Schema.decodeUnknown(MbtMetaSchema)(state),
    (e) =>
      new TraceReplayError({
        message: `Failed to extract MBT metadata: ${e}`,
        traceIndex,
        stepIndex,
        action: "unknown"
      })
  )

const resolveNestedValue = (
  obj: { readonly [key: string]: unknown },
  path: ReadonlyArray<string>
): unknown => {
  let current: unknown = obj
  for (const key of path) {
    if (!Predicate.isRecord(current) || !(key in current)) {
      return undefined
    }
    current = current[key]
  }
  return current
}

const replayTrace = <S, E, R>(
  trace: ItfTrace,
  traceIndex: number,
  driver: Driver<S, E, R>,
  config: Config,
  compareState: StateComparator<S>,
  deserializeState: (raw: unknown) => Effect.Effect<S>
): Effect.Effect<void, E | StateMismatchError | TraceReplayError, R> =>
  Effect.gen(function*() {
    for (const [stepIndex, rawState] of trace.states.entries()) {
      if (stepIndex === 0) continue // skip init state

      const meta = yield* extractMbtMeta(rawState, traceIndex, stepIndex)
      const nondetPicks = new Map(Object.entries(meta["mbt::nondetPicks"]))

      const step = {
        action: meta["mbt::actionTaken"],
        nondetPicks,
        rawState
      }

      yield* Effect.mapError(
        driver.step(step),
        (e: E) =>
          new TraceReplayError({
            message: `Driver step failed: ${String(e)}`,
            traceIndex,
            stepIndex,
            action: step.action,
            cause: e
          })
      )

      const specStateRaw = config.statePath.length > 0
        ? resolveNestedValue(rawState, config.statePath)
        : rawState
      const specState = yield* deserializeState(specStateRaw)
      const implState = yield* driver.getState()

      if (!compareState(specState, implState)) {
        return yield* new StateMismatchError({
          message: `State mismatch at trace ${traceIndex}, step ${stepIndex}, action "${step.action}"`,
          traceIndex,
          stepIndex,
          expected: specState,
          actual: implState
        })
      }
    }
  })

export type QuintRunOptions<S, E, R> = RunOptions & {
  readonly driverFactory: DriverFactory<S, E, R>
  readonly compareState: StateComparator<S>
  readonly deserializeState: (raw: unknown) => Effect.Effect<S>
}

export const quintRun = <S, E, R>(
  opts: QuintRunOptions<S, E, R>
): Effect.Effect<
  { readonly tracesReplayed: number },
  E | QuintError | QuintNotFoundError | StateMismatchError | TraceReplayError | NoTracesError,
  R | FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function*() {
    const traces = yield* generateTraces(opts)
    if (traces.length === 0) {
      return yield* new NoTracesError({
        message: "quint run produced no traces"
      })
    }

    let tracesReplayed = 0
    for (const [traceIndex, trace] of traces.entries()) {
      const driver = yield* opts.driverFactory.create()
      const config = driver.config?.() ?? defaultConfig
      yield* replayTrace(
        trace,
        traceIndex,
        driver,
        config,
        opts.compareState,
        opts.deserializeState
      )
      tracesReplayed++
    }

    return { tracesReplayed }
  })
