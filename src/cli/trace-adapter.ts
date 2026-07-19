import type { Effect } from "effect"

import type { ItfTrace } from "../itf/schema.js"
import type { QuintError, QuintNotFoundError } from "./errors.js"
import type { TraceGenerationOptions } from "./run-options.js"

export interface TraceGenerationAdapter {
  readonly canGenerate: (opts: TraceGenerationOptions) => boolean
  readonly generate: (
    opts: TraceGenerationOptions,
    outDir: string
  ) => Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError>
}
