import { Effect } from "effect"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ItfTrace } from "../itf/schema.js"
import { compiledEvaluatorTraceAdapter } from "./compiled-evaluator-adapter.js"
import type { QuintNotFoundError } from "./errors.js"
import { QuintError } from "./errors.js"
import { platformProcess } from "./platform-process.js"
import { quintCliTraceAdapter } from "./quint-cli-adapter.js"
import type { TraceGenerationOptions } from "./run-options.js"
import type { TraceGenerationAdapter } from "./trace-adapter.js"
import { validateTraceGenerationConfiguration } from "./trace-generation-policy.js"

export { QuintError, QuintNotFoundError } from "./errors.js"
export type {
  QuintRunGeneration,
  QuintTestGeneration,
  RunGenerationOptions,
  RunOptions,
  TestGenerationOptions,
  TraceGenerationMode,
  TraceGenerationOptions
} from "./run-options.js"

const traceGenerationAdapters: ReadonlyArray<TraceGenerationAdapter> = [
  compiledEvaluatorTraceAdapter,
  quintCliTraceAdapter
]

const selectTraceGenerationAdapter = (opts: TraceGenerationOptions): TraceGenerationAdapter =>
  traceGenerationAdapters.find((adapter) => adapter.canGenerate(opts)) ?? quintCliTraceAdapter

const generateTracesInDir = (
  opts: TraceGenerationOptions,
  outDir: string
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> =>
  selectTraceGenerationAdapter(opts).generate(opts, outDir)

const generateTracesWithTraceDir = (
  opts: TraceGenerationOptions,
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
  opts: TraceGenerationOptions
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> =>
  // Rust parity: upstream transfers `TempDir` ownership into `Traces`, whose Drop
  // removes it. Effect's acquire/use/release gives this API the same automatic cleanup,
  // including failure and interruption, without requiring callers to provide a scope.
  // https://github.com/informalsystems/quint-connect/blob/4f018f54fc7dd4cef341d10111427bab59d3b307/connect/src/trace/generator/mod.rs#L23-L33
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "quint-")),
      catch: (e) => new QuintError({ message: `Failed to create temp directory: ${e}` })
    }),
    (tmpDir) => generateTracesInDir(opts, tmpDir),
    (tmpDir) => Effect.promise(() => rm(tmpDir, { recursive: true, force: true }).catch(() => {}))
  )

/** Warn if zombie quint_evaluator processes are running because they cause large slowdowns. */
const warnZombieEvaluators = (): Effect.Effect<void> =>
  Effect.gen(function*() {
    const count = yield* platformProcess.countEvaluatorProcesses
    if (count > 0) {
      yield* Effect.sync(() => {
        console.warn(
          `[quint-connect] WARNING: Found ${count} running quint_evaluator process(es). `
            + `These consume 100% CPU each and will slow down this run by ~40x. `
            + `Kill them: ${platformProcess.evaluatorCleanupHint}`
        )
      })
    }
  })

export const generateTraces = (
  opts: TraceGenerationOptions
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> =>
  Effect.gen(function*() {
    yield* validateTraceGenerationConfiguration(opts)
    yield* warnZombieEvaluators()
    return yield* opts.traceDir !== undefined
      ? generateTracesWithTraceDir(opts, opts.traceDir)
      : generateTracesWithTempDir(opts)
  })
