import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Array as Arr, Effect, Predicate, Schema } from "effect"
import type { QuintError, QuintNotFoundError, RunOptions } from "../cli/quint.js"
import { generateTraces } from "../cli/quint.js"
import type { AnyActionDef, Config, Driver, PartialActionMap, StateComparator } from "../driver/types.js"
import { defaultConfig } from "../driver/types.js"
import type { ItfTrace, MbtMeta } from "../itf/schema.js"
import { ItfOption, MbtMeta as MbtMetaSchema } from "../itf/schema.js"

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

/** @internal */
export const stripMetadata = (state: { readonly [key: string]: unknown }): { readonly [key: string]: unknown } =>
  Object.fromEntries(Object.entries(state).filter(([k]) => k !== "#meta" && !k.startsWith("mbt::")))

/** @internal */
export const jsonReplacer = (_: string, v: unknown): unknown => typeof v === "bigint" ? `${v}n` : v

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
    return Effect.fail(
      new TraceReplayError({
        message: `Expected sum type {tag, value} at path ${nondetPath.join(".")}, got: ${JSON.stringify(raw)}`,
        traceIndex,
        stepIndex,
        action: "unknown"
      })
    )
  }
  const action = raw["tag"]
  const value = raw["value"]
  const picks = Predicate.isRecord(value) ? new Map(Object.entries(value)) : new Map<string, unknown>()
  return Effect.succeed({ action, nondetPicks: picks })
}

const buildPicksDecoder = (picksShape: AnyActionDef["picks"]) => {
  const wrappedFields = Object.fromEntries(
    Object.entries(picksShape.fields).map(([key, fieldSchema]) => [
      key,
      Schema.UndefinedOr(ItfOption(Schema.asSchema(fieldSchema)))
    ])
  )
  return Schema.decodeUnknown(Schema.Struct(wrappedFields))
}

/** @internal */
export const replayTrace = <S, E, R, Actions extends PartialActionMap<E, R>>(
  trace: ItfTrace,
  traceIndex: number,
  driver: Driver<S, E, R, Actions>,
  config: Config,
  stateCheck: StateCheck<S> | undefined,
  seed: string
): Effect.Effect<void, E | StateMismatchError | TraceReplayError, R> =>
  Effect.gen(function*() {
    const picksDecoders = driver.step === undefined
      ? new Map(
        Object.entries(driver.actions)
          .filter((entry): entry is [string, AnyActionDef<E, R>] => entry[1] !== undefined)
          .map(([name, def]) => [name, buildPicksDecoder(def.picks)])
      )
      : undefined

    for (const [stepIndex, rawState] of trace.states.entries()) {
      if (stepIndex === 0) continue // skip init state

      const nondetPath = config.nondetPath ?? []
      const { action, nondetPicks } = nondetPath.length > 0
        ? yield* extractFromNondetPath(rawState, nondetPath, traceIndex, stepIndex)
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

      if (driver.step !== undefined) {
        yield* Effect.mapError(
          driver.step(action, nondetPicks),
          (e: E) =>
            new TraceReplayError({
              message: `step failed: ${String(e)}`,
              traceIndex,
              stepIndex,
              action,
              cause: e
            })
        )
      } else {
        const actionDef = driver.actions[action]
        if (actionDef === undefined) {
          return yield* new TraceReplayError({
            message: action === "init"
              ? `Unknown action: init. This is likely the known Quint typescript backend bug where non-disjunctive step actions report "init" instead of the actual action name. Wrap your step action body in \`any { YourAction, }\` as a workaround, or use \`--backend rust\`.`
              : `Unknown action: ${action}`,
            traceIndex,
            stepIndex,
            action
          })
        }

        const decode = picksDecoders?.get(action) ?? buildPicksDecoder(actionDef.picks)
        const decodedPicks = yield* Effect.mapError(
          decode(Object.fromEntries(nondetPicks)),
          (cause) =>
            new TraceReplayError({
              message: `Failed to decode action picks: ${String(cause)}`,
              traceIndex,
              stepIndex,
              action,
              cause
            })
        )

        yield* Effect.mapError(
          actionDef.handler(decodedPicks),
          (e: E) =>
            new TraceReplayError({
              message: `Action handler failed: ${String(e)}`,
              traceIndex,
              stepIndex,
              action,
              cause: e
            })
        )
      }

      if (stateCheck !== undefined) {
        if (driver.getState === undefined) {
          return yield* new TraceReplayError({
            message:
              "stateCheck is provided but driver.getState is not defined; getState is required when stateCheck is provided",
            traceIndex,
            stepIndex,
            action
          })
        }
        const statePath = config.statePath ?? []
        const specStateRaw = statePath.length > 0
          ? resolveNestedValue(rawState, statePath)
          : stripMetadata(rawState)
        const specState = yield* stateCheck.deserializeState(specStateRaw)
        const implState = yield* driver.getState()

        if (!stateCheck.compareState(specState, implState)) {
          return yield* new StateMismatchError({
            message:
              `State mismatch at trace ${traceIndex}, step ${stepIndex}, action "${action}" (seed: ${seed})\nExpected: ${
                JSON.stringify(specState, jsonReplacer)
              }\nActual: ${JSON.stringify(implState, jsonReplacer)}`,
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

export type QuintRunOptions<
  S,
  E,
  R,
  Actions extends PartialActionMap<E, R> = PartialActionMap<E, R>
> = RunOptions & {
  readonly driverFactory: {
    readonly create: () => Effect.Effect<Driver<S, E, R, Actions>, E, R>
  }
  readonly stateCheck?: StateCheck<S> | undefined
  readonly concurrency?: number | undefined
}

const resolveSeed = (opts: RunOptions): string =>
  opts.seed ?? process.env["QUINT_SEED"] ?? `0x${Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, "0")}`

export const quintRun = <
  S,
  E,
  R,
  Actions extends PartialActionMap<E, R> = PartialActionMap<E, R>
>(
  opts: QuintRunOptions<S, E, R, Actions>
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

    const results = yield* Effect.forEach(
      Arr.map(traces, (trace, traceIndex) => ({ trace, traceIndex })),
      ({ trace, traceIndex }) =>
        Effect.gen(function*() {
          const driver = yield* opts.driverFactory.create()
          const config = { ...defaultConfig, ...driver.config?.() }
          yield* replayTrace(
            trace,
            traceIndex,
            driver,
            config,
            opts.stateCheck,
            seed
          )
        }),
      { concurrency: opts.concurrency ?? 1 }
    )

    return { tracesReplayed: results.length, seed }
  })
