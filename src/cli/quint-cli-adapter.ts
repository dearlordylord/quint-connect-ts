import spawn from "cross-spawn"
import { Effect } from "effect"

import { QuintError, QuintNotFoundError } from "./errors.js"
import { runManagedProcess } from "./managed-process.js"
import { platformProcess } from "./platform-process.js"
import type { PlatformProcessBoundary } from "./platform-process.js"
import type { RunOptions } from "./run-options.js"
import { DEFAULT_MAX_SAMPLES, DEFAULT_N_TRACES } from "./run-options.js"
import type { TraceGenerationAdapter } from "./trace-adapter.js"
import { readTraceFiles } from "./trace-files.js"

interface QuintProcessResult {
  readonly exitCode: number
  readonly stderr: string
}

interface QuintCliAdapterDeps {
  readonly runQuintProcess: (
    args: ReadonlyArray<string>,
    verbose: boolean
  ) => Effect.Effect<QuintProcessResult, QuintNotFoundError>
}

// eslint-disable-next-line functional/no-mixed-types -- process handles mix data fields and event methods.
interface QuintProcess {
  readonly pid: number | undefined
  readonly stdout: {
    readonly resume: () => void
  }
  readonly stderr: {
    readonly on: (event: "data", listener: (chunk: Buffer) => void) => unknown
  }
  readonly on: {
    (event: "close", listener: (code: number | null) => void): unknown
    (event: "error", listener: (e: Error) => void): unknown
  }
}

type SpawnQuintProcess = (
  cmd: string,
  args: ReadonlyArray<string>,
  options: { readonly env: NodeJS.ProcessEnv; readonly detached: boolean }
) => QuintProcess

export const buildRunArgs = (
  opts: RunOptions,
  outDir: string
): ReadonlyArray<string> => {
  const nTraces = opts.nTraces ?? DEFAULT_N_TRACES
  const args: Array<string> = [
    "run",
    opts.spec,
    "--mbt",
    "--n-traces",
    String(nTraces),
    "--out-itf",
    `${outDir}/trace_{seq}.itf.json`
  ]
  const envBackend = process.env["QUINT_BACKEND"]
  const backend = opts.backend ?? (envBackend === "typescript" || envBackend === "rust" ? envBackend : "typescript")
  args.push("--backend", backend)
  if (opts.seed !== undefined) {
    args.push("--seed", opts.seed)
  }
  if (opts.maxSteps !== undefined) {
    args.push("--max-steps", String(opts.maxSteps))
  }
  if (opts.maxSamples !== undefined) {
    args.push("--max-samples", String(opts.maxSamples))
  } else if (opts.seed !== undefined) {
    args.push("--max-samples", String(DEFAULT_MAX_SAMPLES))
  }
  if (opts.init !== undefined) {
    args.push("--init", opts.init)
  }
  if (opts.step !== undefined) {
    args.push("--step", opts.step)
  }
  if (opts.main !== undefined) {
    args.push("--main", opts.main)
  }
  if (opts.invariants !== undefined && opts.invariants.length > 0) {
    args.push("--invariants", ...opts.invariants)
  }
  if (opts.witnesses !== undefined && opts.witnesses.length > 0) {
    args.push("--witnesses", ...opts.witnesses)
  }
  return args
}

export const makeRunQuintProcess = (
  spawnProcess: SpawnQuintProcess = (cmd, cmdArgs, options) => {
    const proc = spawn(cmd, [...cmdArgs], options)
    if (proc.stdout === null || proc.stderr === null) {
      throw new Error("Quint process was spawned without piped output")
    }
    return {
      pid: proc.pid,
      stdout: proc.stdout,
      stderr: proc.stderr,
      on: proc.on.bind(proc)
    }
  },
  processBoundary: PlatformProcessBoundary = platformProcess
) =>
(
  args: ReadonlyArray<string>,
  verbose: boolean
): Effect.Effect<QuintProcessResult, QuintNotFoundError> =>
  Effect.gen(function*() {
    const env = verbose ? { ...process.env, QUINT_VERBOSE: "true" } : process.env
    const runAttempt = (cmd: string, cmdArgs: ReadonlyArray<string>) =>
      runManagedProcess({
        processBoundary,
        spawn: () => spawnProcess(cmd, cmdArgs, { env, detached: processBoundary.detached }),
        captureResult: (proc) => {
          let stderr = ""
          proc.stdout.resume()
          proc.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString()
          })
          return (exitCode) => ({ exitCode, stderr })
        }
      })

    return yield* runAttempt(processBoundary.commandName("quint"), [...args]).pipe(
      Effect.catchTag("ProcessStartError", (error) => {
        if (error.code === "ENOENT") {
          console.warn(
            "[quint-connect] 'quint' not found on PATH, falling back to npx (slower). Install globally: npm i -g @informalsystems/quint"
          )
          return runAttempt(processBoundary.commandName("npx"), ["@informalsystems/quint", ...args])
        }
        return Effect.fail(error)
      }),
      Effect.mapError((error) => new QuintNotFoundError({ message: `Failed to start quint: ${error.message}` }))
    )
  })

const runQuintProcess = makeRunQuintProcess()

export const makeQuintCliTraceAdapter = (
  deps: QuintCliAdapterDeps = { runQuintProcess }
): TraceGenerationAdapter => ({
  canGenerate: () => true,
  generate: (opts, outDir) =>
    Effect.gen(function*() {
      const args = buildRunArgs(opts, outDir)
      const { exitCode, stderr } = yield* deps.runQuintProcess(args, opts.verbose === true)
      if (exitCode !== 0) {
        return yield* new QuintError({
          message: stderr
            ? `quint run failed with exit code ${exitCode}:\n${stderr.trim()}`
            : `quint run failed with exit code ${exitCode}`,
          stderr,
          exitCode
        })
      }
      return yield* readTraceFiles(outDir)
    })
})

export const quintCliTraceAdapter: TraceGenerationAdapter = makeQuintCliTraceAdapter()
