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
  actual: Schema.Unknown,
  showDiff: Schema.optionalWith(Schema.Boolean, { default: () => true })
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

// Extract action + nondet picks from a sum type at a custom path
// (Choreo-style specs where action is encoded as { tag: "ActionName", value: { picks... } })
const extractFromNondetPath = (
  state: { readonly [key: string]: unknown },
  nondetPath: ReadonlyArray<string>,
  traceIndex: number,
  stepIndex: number
): Effect.Effect<{ action: string; nondetPicks: ReadonlyMap<string, unknown> }, TraceReplayError> => {
  const raw = resolveNestedValue(state, nondetPath)
  if (!Predicate.isRecord(raw) || typeof raw["tag"] !== "string") {
    return Effect.fail(new TraceReplayError({
      message: `Expected sum type {tag, value} at path ${nondetPath.join(".")}, got: ${JSON.stringify(raw)}`,
      traceIndex,
      stepIndex,
      action: "unknown"
    }))
  }
  const action = raw["tag"]
  const value = raw["value"]
  const picks = Predicate.isRecord(value) ? new Map(Object.entries(value)) : new Map<string, unknown>()
  return Effect.succeed({ action, nondetPicks: picks })
}

const replayTrace = <S, E, R>(
  trace: ItfTrace,
  traceIndex: number,
  driver: Driver<S, E, R>,
  config: Config,
  stateCheck: StateCheck<S> | undefined,
  seed: string
): Effect.Effect<void, E | StateMismatchError | TraceReplayError, R> =>
  Effect.gen(function*() {
    for (const [stepIndex, rawState] of trace.states.entries()) {
      if (stepIndex === 0) continue // skip init state

      const { action, nondetPicks } = config.nondetPath.length > 0
        ? yield* extractFromNondetPath(rawState, config.nondetPath, traceIndex, stepIndex)
        : yield* Effect.map(extractMbtMeta(rawState, traceIndex, stepIndex), (meta) => ({
          action: meta["mbt::actionTaken"],
          nondetPicks: new Map(Object.entries(meta["mbt::nondetPicks"]))
        }))

      if (action === "") {
        return yield* new TraceReplayError({
          message: `Anonymous action at trace ${traceIndex}, step ${stepIndex}`,
          traceIndex,
          stepIndex,
          action: ""
        })
      }

      const step = {
        action,
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

      if (stateCheck !== undefined) {
        const specStateRaw = config.statePath.length > 0
          ? resolveNestedValue(rawState, config.statePath)
          : rawState
        const specState = yield* stateCheck.deserializeState(specStateRaw)
        const implState = yield* driver.getState()

        if (!stateCheck.compareState(specState, implState)) {
          return yield* new StateMismatchError({
            message: `State mismatch at trace ${traceIndex}, step ${stepIndex}, action "${step.action}" (seed: ${seed})`,
            traceIndex,
            stepIndex,
            expected: specState,
            actual: implState
          })
        }
      }
    }
  })

export interface StateCheck<S> {
  readonly compareState: StateComparator<S>
  readonly deserializeState: (raw: unknown) => Effect.Effect<S>
}

export type QuintRunOptions<S, E, R> = RunOptions & {
  readonly driverFactory: DriverFactory<S, E, R>
  readonly stateCheck?: StateCheck<S> | undefined
}

const resolveSeed = (opts: RunOptions): string =>
  opts.seed ?? process.env["QUINT_SEED"] ?? `0x${Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, "0")}`

export const quintRun = <S, E, R>(
  opts: QuintRunOptions<S, E, R>
): Effect.Effect<
  { readonly tracesReplayed: number; readonly seed: string },
  E | QuintError | QuintNotFoundError | StateMismatchError | TraceReplayError | NoTracesError,
  R | FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function*() {
    const seed = resolveSeed(opts)
    const traces = yield* generateTraces({ ...opts, seed })
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
        opts.stateCheck,
        seed
      )
      tracesReplayed++
    }

    return { tracesReplayed, seed }
  })
