import { Effect } from "effect"

import type { StateComparator } from "../driver/types.js"
import type { ReplayActionContext, StateMismatchError } from "./replay-errors.js"
import { stateMismatchError, TraceReplayError } from "./replay-errors.js"
import { normalizeTraceState } from "./trace-state.js"

export interface StateCheck<S> {
  readonly compareState: StateComparator<S>
  readonly deserializeState: (raw: unknown) => Effect.Effect<S>
}

type RawState = { readonly [key: string]: unknown }

interface StateReadableDriver<S, E, R> {
  readonly getState?: () => Effect.Effect<S, E, R>
}

interface CheckReplayStateOptions<S, E, R> {
  readonly rawState: RawState
  readonly statePath: ReadonlyArray<string>
  readonly driver: StateReadableDriver<S, E, R>
  readonly stateCheck: StateCheck<S>
  readonly context: ReplayActionContext
  readonly seed: string
}

/** @internal */
export const projectState = normalizeTraceState

/** @internal */
export const checkReplayState = <S, E, R>(
  opts: CheckReplayStateOptions<S, E, R>
): Effect.Effect<void, E | StateMismatchError | TraceReplayError, R> =>
  Effect.gen(function*() {
    if (opts.driver.getState === undefined) {
      return yield* new TraceReplayError({
        message:
          "stateCheck is provided but driver.getState is not defined; getState is required when stateCheck is provided",
        traceIndex: opts.context.traceIndex,
        stepIndex: opts.context.stepIndex,
        action: opts.context.action
      })
    }

    const specState = yield* opts.stateCheck.deserializeState(projectState(opts.rawState, opts.statePath))
    const implState = yield* opts.driver.getState()

    if (!opts.stateCheck.compareState(specState, implState)) {
      return yield* stateMismatchError(opts.context, opts.seed, specState, implState)
    }
  })
