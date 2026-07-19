import { Effect, Predicate, Schema } from "effect"

import { QuintError } from "./errors.js"
import { type ItfTraceJson, serializeItfTrace } from "./trace-files.js"

interface JsonParseContext {
  readonly source?: unknown
}

const JSON_INTEGER_LITERAL = /^-?(?:0|[1-9]\d*)$/

const EvaluatorTrace = Schema.Struct({
  "#meta": Schema.optional(Schema.Unknown),
  vars: Schema.Array(Schema.String),
  states: Schema.Array(Schema.Record(Schema.String, Schema.Unknown))
})
const EvaluatorBestTrace = Schema.Struct({ states: EvaluatorTrace })
const EvaluatorSuccessOutput = Schema.Struct({
  status: Schema.Literal("ok"),
  bestTraces: Schema.Array(EvaluatorBestTrace)
})
const EvaluatorOutput = Schema.Record(Schema.String, Schema.Unknown)
const EvaluatorFailureOutput = Schema.Struct({
  status: Schema.Literal("error"),
  errors: Schema.Array(Schema.Unknown)
})

const formatEvaluatorError = (error: unknown): string =>
  Predicate.isObject(error) && typeof error["message"] === "string" ? error["message"] : String(error)

const parseJsonPreservingIntegers = (json: string): unknown =>
  JSON.parse(json, (_key: string, value: unknown, context?: JsonParseContext): unknown => {
    if (typeof value !== "number") {
      return value
    }
    if (typeof context?.source !== "string") {
      throw new Error("Lossless evaluator JSON decoding requires Node.js 22 or newer")
    }
    return JSON_INTEGER_LITERAL.test(context.source) ? BigInt(context.source) : value
  })

const invalidEvaluatorOutput = (error: unknown): QuintError =>
  new QuintError({ message: `Invalid evaluator output: ${error}` })

export const normalizeEvaluatorOutput = (
  stdout: string
): Effect.Effect<ReadonlyArray<ItfTraceJson>, QuintError> =>
  Effect.gen(function*() {
    const jsonLine = stdout.split("\n").filter((line) => line.trimStart().startsWith("{")).pop()
    if (jsonLine === undefined) {
      return yield* new QuintError({ message: "No JSON output from Rust evaluator" })
    }
    const parsedJson: unknown = yield* Effect.try({
      try: () => parseJsonPreservingIntegers(jsonLine),
      catch: (error) => new QuintError({ message: `Failed to parse evaluator output: ${error}` })
    })
    const envelope = yield* Schema.decodeUnknownEffect(EvaluatorOutput)(parsedJson).pipe(
      Effect.mapError(invalidEvaluatorOutput)
    )

    if (envelope["status"] === "error") {
      const failure = yield* Schema.decodeUnknownEffect(EvaluatorFailureOutput)(parsedJson).pipe(
        Effect.mapError(invalidEvaluatorOutput)
      )
      return yield* new QuintError({
        message: `Quint simulation error:\n${failure.errors.map(formatEvaluatorError).join("\n")}`
      })
    }

    const success = yield* Schema.decodeUnknownEffect(EvaluatorSuccessOutput)(parsedJson).pipe(
      Effect.mapError(invalidEvaluatorOutput)
    )
    const traces: ReadonlyArray<ItfTraceJson> = success.bestTraces.map(({ states }) => ({
      vars: states.vars,
      states: states.states,
      ...(!Object.hasOwn(states, "#meta") ? {} : { "#meta": states["#meta"] })
    }))

    // Validate the complete batch before the adapter persists its first trace.
    yield* Effect.forEach(traces, serializeItfTrace)
    return traces
  })
