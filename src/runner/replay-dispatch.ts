import { Effect } from "effect"

import type { Driver, PartialActionMap } from "../driver/types.js"
import type { PicksDecoder } from "./replay-actions.js"
import { buildPicksDecoder } from "./replay-actions.js"
import type { ReplayActionContext, TraceReplayError } from "./replay-errors.js"
import { traceReplayError, unknownActionMessage, withTraceReplayError } from "./replay-errors.js"

type DispatchReplayResult = "dispatched" | "skipped"

const shouldSkipMissingAction = (action: string, stepIndex: number): boolean => stepIndex === 0 || action === "step"

export const dispatchReplayAction = <S, E, R, Actions extends PartialActionMap<E, R>>(
  driver: Driver<S, E, R, Actions>,
  action: string,
  nondetPicks: ReadonlyMap<string, unknown>,
  context: ReplayActionContext,
  picksDecoders: ReadonlyMap<string, PicksDecoder> | undefined
): Effect.Effect<DispatchReplayResult, TraceReplayError, R> =>
  Effect.gen(function*() {
    if (driver.step !== undefined) {
      yield* withTraceReplayError(
        driver.step(action, nondetPicks),
        context,
        (cause) => `step failed: ${String(cause)}`
      )
      return "dispatched" as const
    }

    const actionDef = driver.actions[action]
    if (actionDef === undefined) {
      // At step 0, action is "init"; skip if no handler defined (convenience so users
      // don't need an explicit init handler when their constructor already sets up state).
      // Rust backend emits "step" when the spec's step action body is a direct no-op.
      if (shouldSkipMissingAction(action, context.stepIndex)) {
        return "skipped" as const
      }

      return yield* traceReplayError(context, unknownActionMessage(action))
    }

    const decode = picksDecoders?.get(action) ?? buildPicksDecoder(actionDef.picks)
    const decodedPicks = yield* Effect.mapError(
      decode(Object.fromEntries(nondetPicks)),
      (cause) => traceReplayError(context, `Failed to decode action picks: ${String(cause)}`, cause)
    )

    yield* withTraceReplayError(
      actionDef.handler(decodedPicks),
      context,
      (cause) => `Action handler failed: ${String(cause)}`
    )

    return "dispatched" as const
  })
