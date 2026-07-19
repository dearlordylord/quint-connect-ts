import spawn from "cross-spawn"
import { Effect, Schema } from "effect"

import { QuintError, QuintNotFoundError } from "./errors.js"
import { runManagedProcess } from "./managed-process.js"
import { platformProcess } from "./platform-process.js"
import type { PlatformProcessBoundary } from "./platform-process.js"
import type { TraceGenerationAdapter } from "./trace-adapter.js"
import { readTraceFiles } from "./trace-files.js"
import { resolveTraceGenerationPolicy } from "./trace-generation-policy.js"

export { buildRunArgs, buildTestArgs } from "./trace-generation-policy.js"

interface QuintProcessResult {
  readonly exitCode: number
  readonly stderr: string
}

interface QuintCliAdapterDeps {
  readonly runQuintProcess: (
    args: ReadonlyArray<string>,
    verbose: boolean,
    quintBin?: string | undefined
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

const QuintBinary = Schema.UndefinedOr(Schema.NonEmptyString)

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
  processBoundary: PlatformProcessBoundary = platformProcess,
  getEnvironment: () => NodeJS.ProcessEnv = () => process.env
) =>
(
  args: ReadonlyArray<string>,
  verbose: boolean,
  quintBin?: string | undefined
): Effect.Effect<QuintProcessResult, QuintNotFoundError> =>
  Effect.gen(function*() {
    const baseEnv = getEnvironment()
    const env = verbose ? { ...baseEnv, QUINT_VERBOSE: "true" } : baseEnv
    const configuredQuintBin = yield* Schema.decodeUnknown(QuintBinary)(quintBin ?? baseEnv["QUINT_BIN"]).pipe(
      Effect.mapError((error) =>
        new QuintNotFoundError({ message: `Invalid Quint executable configuration: ${error}` })
      )
    )
    const defaultQuintCommand = processBoundary.commandName("quint")
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

    const primary = runAttempt(configuredQuintBin ?? defaultQuintCommand, [...args])
    return yield* primary.pipe(
      Effect.catchTag("ProcessStartError", (error) => {
        if (configuredQuintBin === undefined && error.code === "ENOENT") {
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
      const policy = resolveTraceGenerationPolicy(opts)
      const args = yield* policy.buildCliArgs(outDir)
      const { exitCode, stderr } = yield* deps.runQuintProcess(args, opts.verbose === true, opts.quintBin)
      if (exitCode !== 0) {
        return yield* new QuintError({
          message: stderr
            ? `${policy.command} failed with exit code ${exitCode}:\n${stderr.trim()}`
            : `${policy.command} failed with exit code ${exitCode}`,
          stderr,
          exitCode
        })
      }
      return yield* readTraceFiles(outDir)
    })
})

export const quintCliTraceAdapter: TraceGenerationAdapter = makeQuintCliTraceAdapter()
