import spawn from "cross-spawn"
import { Effect, Predicate } from "effect"

import { QuintError, QuintNotFoundError } from "./errors.js"
import { platformProcess } from "./platform-process.js"
import type { PlatformProcessBoundary } from "./platform-process.js"
import type { RunOptions } from "./run-options.js"
import { DEFAULT_MAX_SAMPLES, DEFAULT_N_TRACES, isQuintTestGeneration } from "./run-options.js"
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

const resolveBackend = (opts: RunOptions): "typescript" | "rust" => {
  const envBackend = process.env["QUINT_BACKEND"]
  return opts.backend ?? (envBackend === "typescript" || envBackend === "rust" ? envBackend : "typescript")
}

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
  args.push("--backend", resolveBackend(opts))
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

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const buildTestArgs = (
  opts: RunOptions & { readonly generation: { readonly mode: "test"; readonly test: string } },
  outDir: string
): ReadonlyArray<string> => {
  const nTraces = opts.nTraces ?? DEFAULT_N_TRACES
  const args: Array<string> = [
    "test",
    opts.spec,
    "--match",
    `^${escapeRegex(opts.generation.test)}$`,
    "--max-samples",
    String(nTraces),
    "--out-itf",
    `${outDir}/trace_{seq}.itf.json`,
    "--verbosity",
    "0"
  ]
  args.push("--backend", resolveBackend(opts))
  if (opts.seed !== undefined) {
    args.push("--seed", opts.seed)
  }
  if (opts.main !== undefined) {
    args.push("--main", opts.main)
  }
  return args
}

const buildTraceArgs = (
  opts: RunOptions,
  outDir: string
): ReadonlyArray<string> => isQuintTestGeneration(opts) ? buildTestArgs(opts, outDir) : buildRunArgs(opts, outDir)

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
  Effect.callback<QuintProcessResult, QuintNotFoundError>((resume) => {
    const env = verbose ? { ...process.env, QUINT_VERBOSE: "true" } : process.env
    let completeProcess = () => {}
    const startProc = (cmd: string, cmdArgs: ReadonlyArray<string>) => {
      const proc = spawnProcess(cmd, cmdArgs, { env, detached: processBoundary.detached })
      let stderr = ""
      proc.stdout.resume()
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      proc.on("close", (code) => {
        if (proc !== activeProc) {
          return
        }
        completeProcess()
        resume(Effect.succeed({ exitCode: code ?? 1, stderr }))
      })
      proc.on("error", (e) => {
        if (proc !== activeProc) {
          return
        }
        if (Predicate.isObject(e) && e["code"] === "ENOENT" && cmd === processBoundary.commandName("quint")) {
          console.warn(
            "[quint-connect] 'quint' not found on PATH, falling back to npx (slower). Install globally: npm i -g @informalsystems/quint"
          )
          activeProc = startProc(processBoundary.commandName("npx"), ["@informalsystems/quint", ...cmdArgs])
        } else {
          completeProcess()
          resume(Effect.fail(new QuintNotFoundError({ message: `Failed to start quint: ${e}` })))
        }
      })
      return proc
    }

    let activeProc = startProc(processBoundary.commandName("quint"), [...args])
    const lifecycle = processBoundary.makeLifecycle(() => activeProc)
    completeProcess = lifecycle.complete

    return lifecycle.interrupt
  })

const runQuintProcess = makeRunQuintProcess()

export const makeQuintCliTraceAdapter = (
  deps: QuintCliAdapterDeps = { runQuintProcess }
): TraceGenerationAdapter => ({
  canGenerate: () => true,
  generate: (opts, outDir) =>
    Effect.gen(function*() {
      const args = buildTraceArgs(opts, outDir)
      const { exitCode, stderr } = yield* deps.runQuintProcess(args, opts.verbose === true)
      if (exitCode !== 0) {
        const command = isQuintTestGeneration(opts) ? "quint test" : "quint run"
        return yield* new QuintError({
          message: stderr
            ? `${command} failed with exit code ${exitCode}:\n${stderr.trim()}`
            : `${command} failed with exit code ${exitCode}`,
          stderr,
          exitCode
        })
      }
      return yield* readTraceFiles(outDir)
    })
})

export const quintCliTraceAdapter: TraceGenerationAdapter = makeQuintCliTraceAdapter()
