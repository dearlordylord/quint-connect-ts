import { Effect } from "effect"

import type { ActionMap } from "../driver/types.js"
import type { PicksDecoder } from "./replay-actions.js"
import { buildPicksDecoder } from "./replay-actions.js"
import type { ReplayActionContext, TraceReplayError } from "./replay-errors.js"
import { traceReplayError, unknownActionMessage, withTraceReplayError } from "./replay-errors.js"

type DispatchReplayResult = "dispatched" | "skipped"

const shouldSkipMissingAction = (action: string): boolean => action === "step"

export const dispatchReplayAction = <E, R>(
  actions: ActionMap<E, R>,
  action: string,
  nondetPicks: ReadonlyMap<string, unknown>,
  context: ReplayActionContext,
  picksDecoders: ReadonlyMap<string, PicksDecoder> | undefined
): Effect.Effect<DispatchReplayResult, TraceReplayError, R> =>
  Effect.gen(function*() {
    const actionDef = actions[action]
    if (actionDef === undefined) {
      // Rust backend emits "step" when the spec's step action body is a direct no-op.
      if (shouldSkipMissingAction(action)) {
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
