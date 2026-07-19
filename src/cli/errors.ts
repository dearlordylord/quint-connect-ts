import { Schema } from "effect"

export class QuintError extends Schema.TaggedError<QuintError>()("QuintError", {
  message: Schema.String,
  stderr: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number)
}) {}

export class QuintNotFoundError extends Schema.TaggedError<QuintNotFoundError>()("QuintNotFoundError", {
  message: Schema.String
}) {}
