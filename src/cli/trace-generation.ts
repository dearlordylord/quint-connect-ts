import { Context, Layer } from "effect"

import type { Effect } from "effect"
import type { ItfTrace } from "../itf/schema.js"
import type { QuintError, QuintNotFoundError } from "./errors.js"
import { generateTraces } from "./quint.js"
import type { TraceGenerationOptions } from "./run-options.js"

export interface TraceGenerationService {
  readonly generate: (
    opts: TraceGenerationOptions
  ) => Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError>
}

export class TraceGeneration extends Context.Tag("@firfi/quint-connect/TraceGeneration")<
  TraceGeneration,
  TraceGenerationService
>() {}

export const traceGenerationLayer = Layer.succeed(TraceGeneration, { generate: generateTraces })
