import { Context, Effect, Layer } from "effect"

import type { ItfTrace } from "../itf/schema.js"
import type { QuintError, QuintNotFoundError } from "./errors.js"
import { generateTraces } from "./quint.js"
import type { RunOptions } from "./run-options.js"

export interface TraceGenerationService {
  readonly generate: (
    opts: RunOptions
  ) => Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError>
}

export class TraceGeneration extends Context.Service<TraceGeneration, TraceGenerationService>()(
  "@firfi/quint-connect/TraceGeneration"
) {}

export const traceGenerationLayer = Layer.sync(
  TraceGeneration,
  () =>
    TraceGeneration.of({
      generate: Effect.fn("TraceGeneration.generate")(function*(opts: RunOptions) {
        return yield* generateTraces(opts)
      })
    })
)
