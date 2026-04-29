import { Effect } from "effect"
import { spawn } from "node:child_process"

import { QuintError, QuintNotFoundError } from "./errors.js"
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
  options: { readonly env: NodeJS.ProcessEnv; readonly detached: true }
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
  if (opts.invariants !== undefined) {
    for (const inv of opts.invariants) {
      args.push("--invariant", inv)
    }
  }
  if (opts.witnesses !== undefined) {
    for (const wit of opts.witnesses) {
      args.push("--witness", wit)
    }
  }
  return args
}

export const makeRunQuintProcess = (
  spawnProcess: SpawnQuintProcess = (cmd, cmdArgs, options) => {
    const proc = spawn(cmd, [...cmdArgs], options)
    return {
      pid: proc.pid,
      stdout: proc.stdout,
      stderr: proc.stderr,
      on: proc.on.bind(proc)
    }
  }
) =>
(
  args: ReadonlyArray<string>,
  verbose: boolean
): Effect.Effect<QuintProcessResult, QuintNotFoundError> =>
  Effect.async<QuintProcessResult, QuintNotFoundError>((resume) => {
    const env = verbose ? { ...process.env, QUINT_VERBOSE: "true" } : process.env
    const startProc = (cmd: string, cmdArgs: ReadonlyArray<string>) => {
      const proc = spawnProcess(cmd, cmdArgs, { env, detached: true })
      let stderr = ""
      proc.stdout.resume()
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      proc.on("close", (code) => {
        if (proc !== activeProc) {
          return
        }
        process.removeListener("exit", killGroup)
        resume(Effect.succeed({ exitCode: code ?? 1, stderr }))
      })
      proc.on("error", (e) => {
        if (proc !== activeProc) {
          return
        }
        if ((e as NodeJS.ErrnoException).code === "ENOENT" && cmd === "quint") {
          console.warn(
            "[quint-connect] 'quint' not found on PATH, falling back to npx (slower). Install globally: npm i -g @informalsystems/quint"
          )
          activeProc = startProc("npx", ["@informalsystems/quint", ...cmdArgs])
        } else {
          process.removeListener("exit", killGroup)
          resume(Effect.fail(new QuintNotFoundError({ message: `Failed to start quint: ${e}` })))
        }
      })
      return proc
    }

    let killGroup = () => {}

    let activeProc = startProc("quint", [...args])

    killGroup = () => {
      try {
        const pid = activeProc.pid
        if (pid !== undefined) {
          process.kill(-pid, "SIGKILL")
        }
      } catch {
        // already dead
      }
    }
    process.on("exit", killGroup)

    return Effect.sync(() => {
      process.removeListener("exit", killGroup)
      killGroup()
    })
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
