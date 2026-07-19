import { Effect } from "effect"

import type { StateComparator } from "../driver/types.js"
import type { ReplayStep } from "./replay-actions.js"
import type { ReplayActionContext, StateMismatchError } from "./replay-errors.js"
import { stateMismatchError, TraceReplayError, withTraceReplayError } from "./replay-errors.js"

export interface StateCheck<S, E = never, R = never> {
  readonly compareState: StateComparator<S>
  readonly deserializeState: (raw: unknown) => Effect.Effect<S, E, R>
}

interface StateReadableDriver<S, E, R> {
  readonly getState?: () => Effect.Effect<S, E, R>
}

interface CheckReplayStateOptions<S, DriverE, DriverR, StateE, StateR> {
  readonly step: ReplayStep
  readonly driver: StateReadableDriver<S, DriverE, DriverR>
  readonly stateCheck: StateCheck<S, StateE, StateR>
  readonly context: ReplayActionContext
  readonly seed: string
}

/** @internal */
export const checkReplayState = <S, DriverE, DriverR, StateE = never, StateR = never>(
  opts: CheckReplayStateOptions<S, DriverE, DriverR, StateE, StateR>
): Effect.Effect<void, DriverE | StateMismatchError | TraceReplayError, DriverR | StateR> =>
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

    const specState = yield* withTraceReplayError(
      opts.stateCheck.deserializeState(opts.step.specState),
      opts.context,
      (cause) => `Failed to deserialize spec state: ${String(cause)}`
    )
    const implState = yield* opts.driver.getState()

    if (!opts.stateCheck.compareState(specState, implState)) {
      return yield* stateMismatchError(opts.context, opts.seed, specState, implState)
    }
  })
