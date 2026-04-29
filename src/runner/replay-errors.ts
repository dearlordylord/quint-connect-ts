import { Effect, Schema } from "effect"

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

export interface ReplayStepContext {
  readonly traceIndex: number
  readonly stepIndex: number
}

export interface ReplayActionContext extends ReplayStepContext {
  readonly action: string
}

export const actionContext = (context: ReplayStepContext, action: string): ReplayActionContext => ({
  ...context,
  action
})

export const traceReplayError = (
  context: ReplayActionContext,
  message: string,
  cause?: unknown
): TraceReplayError =>
  new TraceReplayError({
    message,
    traceIndex: context.traceIndex,
    stepIndex: context.stepIndex,
    action: context.action,
    ...(cause === undefined ? {} : { cause })
  })

export const unknownActionMessage = (action: string): string =>
  action === "init"
    ? `Unknown action: init. This is likely the known Quint typescript backend bug (https://github.com/informalsystems/quint/pull/1929) where non-disjunctive step actions report "init" instead of the actual action name. Wrap your step action body in \`any { YourAction, }\` as a workaround, or use \`--backend rust\`.`
    : `Unknown action: ${action}`

export const withTraceReplayError = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  context: ReplayActionContext,
  formatMessage: (cause: unknown) => string
): Effect.Effect<A, TraceReplayError, R> =>
  effect.pipe(
    Effect.mapError((cause: E) => traceReplayError(context, formatMessage(cause), cause)),
    Effect.catchAllDefect((defect) => Effect.fail(traceReplayError(context, formatMessage(defect), defect)))
  )

/** @internal */
export const jsonReplacer = (_: string, v: unknown): unknown => typeof v === "bigint" ? `${v}n` : v

export const stateMismatchError = (
  context: ReplayActionContext,
  seed: string,
  expected: unknown,
  actual: unknown
): StateMismatchError =>
  new StateMismatchError({
    message:
      `State mismatch at trace ${context.traceIndex}, step ${context.stepIndex}, action "${context.action}" (seed: ${seed})\nExpected: ${
        JSON.stringify(expected, jsonReplacer)
      }\nActual: ${JSON.stringify(actual, jsonReplacer)}`,
    traceIndex: context.traceIndex,
    stepIndex: context.stepIndex,
    expected,
    actual
  })
