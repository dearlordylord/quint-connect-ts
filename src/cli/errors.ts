import { Schema } from "effect"

export class QuintError extends Schema.TaggedErrorClass<QuintError>()("QuintError", {
  message: Schema.String,
  stderr: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number)
}) {}

export class QuintNotFoundError extends Schema.TaggedErrorClass<QuintNotFoundError>()("QuintNotFoundError", {
  message: Schema.String
}) {}
