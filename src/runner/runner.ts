import { Array as Arr, Effect } from "effect"
import type { QuintError, QuintNotFoundError, RunOptions } from "../cli/quint.js"
import { generateTraces } from "../cli/quint.js"
import type { ActionMap, Config, Driver } from "../driver/types.js"
import { defaultConfig } from "../driver/types.js"
import type { ItfTrace } from "../itf/schema.js"
import { buildPicksDecoders, extractReplayAction } from "./replay-actions.js"
import { dispatchReplayAction } from "./replay-dispatch.js"
import {
  actionContext,
  jsonReplacer,
  NoTracesError,
  StateMismatchError,
  TraceReplayError,
  traceReplayError
} from "./replay-errors.js"
import type { StateCheck } from "./state-check.js"
import { checkReplayState } from "./state-check.js"
import { stripMetadata } from "./trace-state.js"

export { jsonReplacer, NoTracesError, StateMismatchError, stripMetadata, TraceReplayError }
export type { StateCheck } from "./state-check.js"

/** @internal */
export const replayTrace = <S, E, R, Actions extends ActionMap<E, R>>(
  trace: ItfTrace,
  traceIndex: number,
  driver: Driver<S, E, R, Actions>,
  config: Config,
  stateCheck: StateCheck<S> | undefined,
  seed: string
): Effect.Effect<void, E | StateMismatchError | TraceReplayError, R> =>
  Effect.gen(function*() {
    const picksDecoders = buildPicksDecoders(driver.actions)

    const statePath = config.statePath ?? []
    const nondetPath = config.nondetPath ?? []

    for (const [stepIndex, rawState] of trace.states.entries()) {
      const stepContext = { traceIndex, stepIndex }
      const { action, nondetPicks } = yield* extractReplayAction(rawState, nondetPath, stepContext)
      const context = actionContext(stepContext, action)

      // Defensive: skip step 0 if actionTaken is empty (both backends normally produce "init").
      if (action === "") {
        if (stepIndex === 0) continue
        return yield* traceReplayError(context, `Anonymous action at trace ${traceIndex}, step ${stepIndex}`)
      }

      const dispatchResult = yield* dispatchReplayAction(driver.actions, action, nondetPicks, context, picksDecoders)
      if (dispatchResult === "skipped") continue

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
  Actions extends ActionMap<E, R> = ActionMap<E, R>
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
  Actions extends ActionMap<E, R> = ActionMap<E, R>
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
