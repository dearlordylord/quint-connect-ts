import { Schema } from "effect"

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
