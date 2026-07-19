import type { Effect } from "effect"

import type { ItfTrace } from "../itf/schema.js"
import type { QuintError, QuintNotFoundError } from "./errors.js"
import type { RunOptions } from "./run-options.js"

export interface TraceGenerationAdapter {
  readonly canGenerate: (opts: RunOptions) => boolean
  readonly generate: (
    opts: RunOptions,
    outDir: string
  ) => Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError>
}
