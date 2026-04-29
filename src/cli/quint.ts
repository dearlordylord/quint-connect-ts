import { Effect } from "effect"
import { execSync } from "node:child_process"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ItfTrace } from "../itf/schema.js"
import { compiledEvaluatorTraceAdapter } from "./compiled-evaluator-adapter.js"
import type { QuintNotFoundError } from "./errors.js"
import { QuintError } from "./errors.js"
import { quintCliTraceAdapter } from "./quint-cli-adapter.js"
import type { RunOptions } from "./run-options.js"
import type { TraceGenerationAdapter } from "./trace-adapter.js"

export { QuintError, QuintNotFoundError } from "./errors.js"
export type { RunOptions } from "./run-options.js"

const traceGenerationAdapters: ReadonlyArray<TraceGenerationAdapter> = [
  compiledEvaluatorTraceAdapter,
  quintCliTraceAdapter
]

const selectTraceGenerationAdapter = (opts: RunOptions): TraceGenerationAdapter =>
  traceGenerationAdapters.find((adapter) => adapter.canGenerate(opts)) ?? quintCliTraceAdapter

const generateTracesInDir = (
  opts: RunOptions,
  outDir: string
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> =>
  selectTraceGenerationAdapter(opts).generate(opts, outDir)

const generateTracesWithTraceDir = (
  opts: RunOptions,
  traceDir: string
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> =>
  Effect.gen(function*() {
    yield* Effect.tryPromise({
      try: () => mkdir(traceDir, { recursive: true }),
      catch: (e) => new QuintError({ message: `Failed to create trace directory: ${e}` })
    })
    return yield* generateTracesInDir(opts, traceDir)
  })

const generateTracesWithTempDir = (
  opts: RunOptions
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "quint-")),
      catch: (e) => new QuintError({ message: `Failed to create temp directory: ${e}` })
    }),
    (tmpDir) => generateTracesInDir(opts, tmpDir),
    (tmpDir) => Effect.promise(() => rm(tmpDir, { recursive: true, force: true }).catch(() => {}))
  )

/** Warn if zombie quint_evaluator processes are running because they cause large slowdowns. */
const warnZombieEvaluators = (): void => {
  try {
    const result = execSync("pgrep -c quint_evaluator", { stdio: ["pipe", "pipe", "pipe"] }).toString().trim()
    const count = parseInt(result, 10)
    if (count > 0) {
      console.warn(
        `[quint-connect] WARNING: Found ${count} running quint_evaluator process(es). `
          + `These consume 100% CPU each and will slow down this run by ~40x. `
          + `Kill them: killall -9 quint_evaluator`
      )
    }
  } catch {
    // pgrep returns exit code 1 when no processes match.
  }
}

export const generateTraces = (
  opts: RunOptions
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> => {
  warnZombieEvaluators()
  return opts.traceDir !== undefined
    ? generateTracesWithTraceDir(opts, opts.traceDir)
    : generateTracesWithTempDir(opts)
}
