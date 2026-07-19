import { Effect, Option, Predicate, Schema } from "effect"

import { QuintError } from "./errors.js"
import type { ItfTraceJson } from "./trace-files.js"

const JSON_BIGINT_SENTINEL = "#quintConnectBigInt"

const EvaluatorTraceStates = Schema.Struct({
  "#meta": Schema.optional(Schema.Unknown),
  vars: Schema.optional(Schema.Unknown),
  states: Schema.optional(Schema.Unknown)
})
const EvaluatorBestTrace = Schema.Struct({ states: EvaluatorTraceStates })
const EvaluatorOutput = Schema.Record(Schema.String, Schema.Unknown)
const EvaluatorErrorStatus = Schema.Literal("error")
const EvaluatorErrors = Schema.Array(Schema.Unknown)
const EvaluatorBestTraces = Schema.Array(Schema.Unknown)

const formatEvaluatorError = (error: unknown): string =>
  Predicate.isObject(error) && typeof error["message"] === "string" ? error["message"] : String(error)

const isJsonDigit = (char: string): boolean => char >= "0" && char <= "9"

const wrapJsonIntegerLiterals = (json: string): string => {
  let result = ""
  let index = 0
  let inString = false
  let escaped = false

  while (index < json.length) {
    const char = json[index]
    if (inString) {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === "\"") {
        inString = false
      }
      index += 1
      continue
    }
    if (char === "\"") {
      inString = true
      result += char
      index += 1
      continue
    }
    if (char === "-" || isJsonDigit(char)) {
      const start = index
      let cursor = char === "-" ? index + 1 : index
      while (cursor < json.length && isJsonDigit(json[cursor])) {
        cursor += 1
      }
      const isInteger = cursor > start && json[cursor] !== "." && json[cursor] !== "e" && json[cursor] !== "E"
      if (!isInteger) {
        while (
          cursor < json.length
          && ![",", "]", "}", " ", "\n", "\r", "\t"].includes(json[cursor])
        ) {
          cursor += 1
        }
      }
      const token = json.slice(start, cursor)
      result += isInteger ? `{"${JSON_BIGINT_SENTINEL}":"${token}"}` : token
      index = cursor
      continue
    }
    result += char
    index += 1
  }
  return result
}

const unwrapJsonBigIntSentinel = (_key: string, value: unknown): unknown => {
  if (
    Predicate.isObject(value)
    && Object.keys(value).length === 1
    && typeof value[JSON_BIGINT_SENTINEL] === "string"
  ) {
    return BigInt(value[JSON_BIGINT_SENTINEL])
  }
  return value
}

export const normalizeEvaluatorOutput = (
  stdout: string
): Effect.Effect<ReadonlyArray<ItfTraceJson>, QuintError> =>
  Effect.gen(function*() {
    const jsonLine = stdout.split("\n").filter((line) => line.trimStart().startsWith("{")).pop()
    if (jsonLine === undefined) {
      return yield* new QuintError({ message: "No JSON output from Rust evaluator" })
    }
    const parsedJson: unknown = yield* Effect.try({
      try: () => JSON.parse(wrapJsonIntegerLiterals(jsonLine), unwrapJsonBigIntSentinel),
      catch: (e) => new QuintError({ message: `Failed to parse evaluator output: ${e}` })
    })
    const parsed = yield* Schema.decodeUnknownEffect(EvaluatorOutput)(parsedJson).pipe(
      Effect.orElseSucceed(() => EvaluatorOutput.make({}))
    )
    if (Option.isSome(Schema.decodeUnknownOption(EvaluatorErrorStatus)(parsed["status"]))) {
      const decodedErrors = Schema.decodeUnknownOption(EvaluatorErrors)(parsed["errors"])
      const errors = Option.isSome(decodedErrors) ? decodedErrors.value : []
      return yield* new QuintError({
        message: `Quint simulation error:\n${errors.map(formatEvaluatorError).join("\n")}`
      })
    }
    const decodedBestTraces = Schema.decodeUnknownOption(EvaluatorBestTraces)(parsed["bestTraces"])
    const bestTraces = Option.isSome(decodedBestTraces) ? decodedBestTraces.value : []
    return bestTraces.flatMap((rawTrace): ReadonlyArray<ItfTraceJson> => {
      const decoded = Schema.decodeUnknownOption(EvaluatorBestTrace)(rawTrace)
      return Option.isNone(decoded)
        ? []
        : [{
          vars: decoded.value.states.vars,
          states: decoded.value.states.states,
          ...(!Object.hasOwn(decoded.value.states, "#meta")
            ? {}
            : { "#meta": decoded.value.states["#meta"] })
        }]
    })
  })
