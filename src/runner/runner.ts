import { Array as Arr, Effect, Predicate, Schema } from "effect"
import type { QuintError, QuintNotFoundError, RunOptions } from "../cli/quint.js"
import { generateTraces } from "../cli/quint.js"
import type { AnyActionDef, Config, Driver, PartialActionMap } from "../driver/types.js"
import { defaultConfig } from "../driver/types.js"
import type { ItfTrace, MbtMeta } from "../itf/schema.js"
import { ItfOption, MbtMeta as MbtMetaSchema } from "../itf/schema.js"
import { NoTracesError, TraceReplayError } from "./errors.js"
import type { StateCheck, StateMismatchError } from "./state-check.js"
import { checkReplayState, resolveNestedValue } from "./state-check.js"

export { NoTracesError, TraceReplayError } from "./errors.js"
export type { StateCheck } from "./state-check.js"
export { jsonReplacer, StateMismatchError, stripMetadata } from "./state-check.js"

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

    const statePath = config.statePath ?? []
    const nondetPath = config.nondetPath ?? []

    for (const [stepIndex, rawState] of trace.states.entries()) {
      const { action, nondetPicks } = nondetPath.length > 0
        ? yield* extractFromNondetPath(rawState, nondetPath, traceIndex, stepIndex)
        : yield* Effect.map(extractMbtMeta(rawState, traceIndex, stepIndex), (meta) => ({
          action: meta["mbt::actionTaken"],
          nondetPicks: new Map(Object.entries(meta["mbt::nondetPicks"]))
        }))

      // Defensive: skip step 0 if actionTaken is empty (both backends normally produce "init").
      if (action === "") {
        if (stepIndex === 0) continue
        return yield* new TraceReplayError({
          message: `Anonymous action at trace ${traceIndex}, step ${stepIndex}`,
          traceIndex,
          stepIndex,
          action: ""
        })
      }

      if (driver.step !== undefined) {
        yield* driver.step(action, nondetPicks).pipe(
          Effect.mapError((e: E) =>
            new TraceReplayError({
              message: `step failed: ${String(e)}`,
              traceIndex,
              stepIndex,
              action,
              cause: e
            })
          ),
          Effect.catchAllDefect((defect) =>
            Effect.fail(
              new TraceReplayError({
                message: `step failed: ${String(defect)}`,
                traceIndex,
                stepIndex,
                action,
                cause: defect
              })
            )
          )
        )
      } else {
        const actionDef = driver.actions[action]
        if (actionDef === undefined) {
          // At step 0, action is "init" — skip if no handler defined (convenience so users
          // don't need an explicit init handler when their constructor already sets up state).
          if (stepIndex === 0) continue
          // Rust backend emits "step" when the spec's step action body is a direct no-op
          // (e.g. state' = state for a dead character). Skip since there's nothing to dispatch.
          if (action === "step") continue
          return yield* new TraceReplayError({
            message: action === "init"
              ? `Unknown action: init. This is likely the known Quint typescript backend bug (https://github.com/informalsystems/quint/pull/1929) where non-disjunctive step actions report "init" instead of the actual action name. Wrap your step action body in \`any { YourAction, }\` as a workaround, or use \`--backend rust\`.`
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

        yield* actionDef.handler(decodedPicks).pipe(
          Effect.mapError((e: E) =>
            new TraceReplayError({
              message: `Action handler failed: ${String(e)}`,
              traceIndex,
              stepIndex,
              action,
              cause: e
            })
          ),
          Effect.catchAllDefect((defect) =>
            Effect.fail(
              new TraceReplayError({
                message: `Action handler failed: ${String(defect)}`,
                traceIndex,
                stepIndex,
                action,
                cause: defect
              })
            )
          )
        )
      }

      if (stateCheck !== undefined) {
        yield* checkReplayState({
          rawState,
          statePath,
          driver,
          stateCheck,
          traceIndex,
          stepIndex,
          action,
          seed
        })
      }
    }
  })

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

/** Resolve the seed. Always generates a real seed so failures are reproducible. */
const resolveSeed = (opts: RunOptions): string => {
  return opts.seed ?? process.env["QUINT_SEED"]
    ?? `0x${Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, "0")}`
}

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
  R
> =>
  Effect.gen(function*() {
    const seed = resolveSeed(opts)
    const traceOpts = { ...opts, seed }
    const traces = yield* generateTraces(traceOpts)
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
