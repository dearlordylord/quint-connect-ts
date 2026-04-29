import { Effect, Predicate, Schema } from "effect"

import type { StateComparator } from "../driver/types.js"
import { TraceReplayError } from "./errors.js"

export class StateMismatchError extends Schema.TaggedError<StateMismatchError>()("StateMismatchError", {
  message: Schema.String,
  traceIndex: Schema.Number,
  stepIndex: Schema.Number,
  expected: Schema.Unknown,
  actual: Schema.Unknown,
  showDiff: Schema.optionalWith(Schema.Boolean, { default: () => true })
}) {}

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
  readonly traceIndex: number
  readonly stepIndex: number
  readonly action: string
  readonly seed: string
}

/** @internal */
export const stripMetadata = (state: RawState): RawState =>
  Object.fromEntries(Object.entries(state).filter(([k]) => k !== "#meta" && !k.startsWith("mbt::")))

/** @internal */
export const jsonReplacer = (_: string, v: unknown): unknown => typeof v === "bigint" ? `${v}n` : v

/** @internal */
export const resolveNestedValue = (
  obj: RawState,
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

/** @internal */
export const projectState = (
  rawState: RawState,
  statePath: ReadonlyArray<string>
): unknown =>
  statePath.length > 0
    ? resolveNestedValue(rawState, statePath)
    : stripMetadata(rawState)

/** @internal */
export const checkReplayState = <S, E, R>(
  opts: CheckReplayStateOptions<S, E, R>
): Effect.Effect<void, E | StateMismatchError | TraceReplayError, R> =>
  Effect.gen(function*() {
    const getState = opts.driver.getState
    if (getState === undefined) {
      return yield* new TraceReplayError({
        message:
          "stateCheck is provided but driver.getState is not defined; getState is required when stateCheck is provided",
        traceIndex: opts.traceIndex,
        stepIndex: opts.stepIndex,
        action: opts.action
      })
    }

    const specState = yield* opts.stateCheck.deserializeState(projectState(opts.rawState, opts.statePath))
    const implState = yield* getState()

    if (!opts.stateCheck.compareState(specState, implState)) {
      return yield* new StateMismatchError({
        message:
          `State mismatch at trace ${opts.traceIndex}, step ${opts.stepIndex}, action "${opts.action}" (seed: ${opts.seed})\nExpected: ${
            JSON.stringify(specState, jsonReplacer)
          }\nActual: ${JSON.stringify(implState, jsonReplacer)}`,
        traceIndex: opts.traceIndex,
        stepIndex: opts.stepIndex,
        expected: specState,
        actual: implState
      })
    }
  })
