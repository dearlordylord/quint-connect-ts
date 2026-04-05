import { Effect, Schema } from "effect"
import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { ItfTrace } from "../itf/schema.js"

export class QuintError extends Schema.TaggedError<QuintError>()("QuintError", {
  message: Schema.String,
  stderr: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number)
}) {}

export class QuintNotFoundError extends Schema.TaggedError<QuintNotFoundError>()("QuintNotFoundError", {
  message: Schema.String
}) {}

export interface RunOptions {
  readonly spec: string
  readonly seed?: string | undefined
  readonly nTraces?: number | undefined
  readonly maxSteps?: number | undefined
  readonly maxSamples?: number | undefined
  readonly init?: string | undefined
  readonly step?: string | undefined
  readonly main?: string | undefined
  readonly invariants?: ReadonlyArray<string> | undefined
  readonly witnesses?: ReadonlyArray<string> | undefined
  readonly backend?: "typescript" | "rust" | undefined
  readonly verbose?: boolean | undefined
  readonly traceDir?: string | undefined
  /**
   * Path to a pre-compiled evaluator input JSON file (produced by `quint-connect-compile`).
   * When provided and the file exists, skips `quint run` entirely and calls the Rust
   * evaluator directly. The file contains the parsed spec + resolver table, so the 15s+
   * parse/typecheck overhead is eliminated on repeat runs.
   *
   * The runtime parameters (maxSamples, maxSteps, nTraces, seed) are patched into the
   * cached input before sending to the evaluator.
   */
  readonly compiledInput?: string | undefined
}

const DEFAULT_N_TRACES = 10
// quint defaults maxSamples to 1 when --seed is provided; use the non-seed default instead
const DEFAULT_MAX_SAMPLES = 10000

const buildRunArgs = (
  opts: RunOptions,
  outDir: string
): Array<string> => {
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

const runQuintProcess = (
  args: ReadonlyArray<string>,
  verbose: boolean
): Effect.Effect<{ readonly exitCode: number; readonly stderr: string }, QuintNotFoundError> =>
  Effect.async<{ readonly exitCode: number; readonly stderr: string }, QuintNotFoundError>((resume) => {
    const env = verbose ? { ...process.env, QUINT_VERBOSE: "true" } : process.env
    // detached: true creates a new process group so we can kill the entire tree
    // (quint spawns quint_evaluator as a child — plain proc.kill() leaves it orphaned)
    // Try direct `quint` first (avoids ~3s npx overhead), fall back to npx on ENOENT
    const startProc = (cmd: string, cmdArgs: ReadonlyArray<string>) => {
      const proc = spawn(cmd, cmdArgs, { env, detached: true })
      let stderr = ""
      proc.stdout.resume()
      proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
      proc.on("close", (code) => resume(Effect.succeed({ exitCode: code ?? 1, stderr })))
      proc.on("error", (e) => {
        if ((e as NodeJS.ErrnoException).code === "ENOENT" && cmd === "quint") {
          // quint not on PATH — fall back to npx (~3s slower)
          console.warn("[quint-connect] 'quint' not found on PATH, falling back to npx (slower). Install globally: npm i -g @informalsystems/quint")
          activeProc = startProc("npx", ["@informalsystems/quint", ...cmdArgs])
        } else {
          resume(Effect.fail(new QuintNotFoundError({ message: `Failed to start quint: ${e}` })))
        }
      })
      return proc
    }
    // eslint-disable-next-line prefer-const -- reassigned in ENOENT fallback
    let activeProc = startProc("quint", [...args])
    return Effect.sync(() => {
      // Kill the entire process group (quint + quint_evaluator)
      try { process.kill(-activeProc.pid!, "SIGKILL") } catch { activeProc.kill("SIGKILL") }
    })
  })

// ---------------------------------------------------------------------------
// Evaluator-direct path: bypass `quint run`, call `quint_evaluator` directly
// ---------------------------------------------------------------------------

const getRustEvaluatorPath = (): string => {
  // Match Quint's binary manager lookup: ~/.quint/rust-evaluator-v{version}/quint_evaluator
  const quintDir = join(homedir(), ".quint")
  if (!existsSync(quintDir)) {
    throw new Error(`Quint home directory not found: ${quintDir}`)
  }
  // Find a rust-evaluator directory. Prefer the version specified by QUINT_EVALUATOR_VERSION
  // env var, otherwise use the latest available.
  const preferredVersion = process.env["QUINT_EVALUATOR_VERSION"]
  const dirs = readdirSync(quintDir).filter((d: string) => d.startsWith("rust-evaluator-")).sort()
  if (dirs.length === 0) {
    throw new Error("No Rust evaluator found in ~/.quint/. Run `quint run` once with --backend rust to download it.")
  }
  const preferred = preferredVersion
    ? dirs.find((d: string) => d.includes(preferredVersion))
    : undefined
  const latest = preferred ?? dirs[dirs.length - 1]
  const exePath = join(quintDir, latest, "quint_evaluator")
  if (!existsSync(exePath)) {
    throw new Error(`Rust evaluator binary not found: ${exePath}`)
  }
  return exePath
}

const runEvaluatorDirect = (
  evaluatorPath: string,
  inputStr: string
): Effect.Effect<
  { readonly stdout: string; readonly exitCode: number; readonly stderr: string },
  QuintNotFoundError
> =>
  Effect.async((resume) => {
    let stdout = ""
    let stderr = ""
    const proc = spawn(evaluatorPath, ["simulate-from-stdin"], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true
    })

    // Write directly to stdin (no file round-trip)
    proc.stdin.write(inputStr)
    proc.stdin.end()

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on("close", (code) => {
      resume(Effect.succeed({ stdout, exitCode: code ?? 1, stderr }))
    })
    proc.on("error", (e) => {
      resume(Effect.fail(new QuintNotFoundError({ message: `Failed to start Rust evaluator: ${e}` })))
    })
    return Effect.sync(() => {
      try { process.kill(-proc.pid!, "SIGKILL") } catch { proc.kill("SIGKILL") }
    })
  })

/**
 * Run the Rust evaluator directly with a pre-compiled input, patching runtime
 * parameters (nruns, nsteps, ntraces, seed) into the cached JSON.
 *
 * The evaluator writes ITF trace JSON to stdout, progress to stderr.
 * We parse the stdout result to extract traces.
 */
const runFromCompiledInput = (
  compiledInputPath: string,
  opts: RunOptions,
  outDir: string
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> =>
  Effect.gen(function*() {
    // Read cached compiled input
    const rawInput = yield* Effect.tryPromise({
      try: () => readFile(compiledInputPath, "utf-8"),
      catch: (e) => new QuintError({ message: `Failed to read compiled input: ${e}` })
    })

    // Patch runtime parameters into the JSON
    // The cached input has: { parsed, source, nruns, nsteps, ntraces, nthreads, seed, mbt, verbosity }
    // We need to update nruns (maxSamples), nsteps, ntraces, and optionally seed.
    const nTraces = opts.nTraces ?? DEFAULT_N_TRACES
    const maxSamples = opts.maxSamples ?? DEFAULT_MAX_SAMPLES
    const maxSteps = opts.maxSteps ?? 10

    // Match quint run's thread calculation: Math.min(maxSamples, cpuCount).
    // Must be >= 2 to avoid a deadlock bug in the Rust evaluator (v0.5.0).
    const { cpus } = require("node:os") as typeof import("node:os")
    const nThreads = Math.max(2, Math.min(maxSamples, cpus().length))

    // Use simple string replacement to avoid parsing the entire 7MB JSON
    let patchedInput = rawInput
      .replace(/"nruns":\s*\d+/, `"nruns":${maxSamples}`)
      .replace(/"nsteps":\s*\d+/, `"nsteps":${maxSteps}`)
      .replace(/"ntraces":\s*\d+/, `"ntraces":${nTraces}`)
      .replace(/"nthreads":\s*\d+/, `"nthreads":${nThreads}`)

    if (opts.seed !== undefined) {
      // Seed can be a hex string like "0xfa2124eb" — convert to bigint for the evaluator
      const seedBigint = opts.seed.startsWith("0x")
        ? BigInt(opts.seed)
        : BigInt(`0x${opts.seed}`)
      patchedInput = patchedInput.replace(/"seed":\s*(?:null|undefined|\d+)/, `"seed":${seedBigint}`)
    }

    // Write patched input directly to stdin (matching commandWrapper.simulate behavior).
    // CRITICAL: Do NOT read from file — the file round-trip through Node.js readFile/createReadStream
    // silently corrupts json-bigint output (BigInt integers → float64), causing the evaluator to hang.
    // Direct proc.stdin.write() preserves the exact bytes from json-bigint.stringify().
    const evaluatorPath = getRustEvaluatorPath()

    const result = yield* runEvaluatorDirect(evaluatorPath, patchedInput)

    if (result.exitCode !== 0) {
      return yield* new QuintError({
        message: `Rust evaluator failed with exit code ${result.exitCode}:\n${result.stderr}`,
        stderr: result.stderr,
        exitCode: result.exitCode
      })
    }

    // Parse the evaluator's JSON output to extract ITF traces
    // The output format is: { status, errors, bestTraces: [{ seed, states: ITF, ... }], ... }
    // We need to extract states from bestTraces and write them as individual ITF trace files.
    let parsed: any
    try {
      // The output might contain non-JSON lines (progress, warnings) before the JSON result.
      // The JSON result is the last line that starts with '{'.
      const lines = result.stdout.split("\n")
      const jsonLine = lines.filter(l => l.trimStart().startsWith("{")).pop()
      if (!jsonLine) {
        return yield* new QuintError({ message: "No JSON output from Rust evaluator" })
      }
      // Parse with integer-to-bigint reviver to match `quint run --out-itf` behavior.
      // Quint's `json-bigint` library serializes all integers as bigints in ITF traces.
      parsed = JSON.parse(jsonLine, (_key, value) =>
        typeof value === "number" && Number.isInteger(value) ? BigInt(value) : value
      )
    } catch (e) {
      return yield* new QuintError({ message: `Failed to parse evaluator output: ${e}` })
    }

    if (parsed.status === "error") {
      const errMsgs = (parsed.errors || []).map((e: any) => e.message || String(e)).join("\n")
      return yield* new QuintError({ message: `Quint simulation error:\n${errMsgs}` })
    }

    // Write ITF trace files to outDir (matching `quint run --out-itf` format).
    // The evaluator wraps traces in { #meta, params, vars, loop, states }.
    // `quint run --out-itf` strips to { #meta, vars, states }. Match that format.
    //
    // Critical: The evaluator outputs plain integers (28), but `quint run --out-itf`
    // uses the ITF #bigint encoding ({"#bigint":"28"}). Convert integers to #bigint
    // format to match what quint-connect/itf-trace-parser expects.
    const traces: Array<ItfTrace> = []
    const bestTraces = parsed.bestTraces || []
    for (let i = 0; i < bestTraces.length; i++) {
      const bt = bestTraces[i]
      if (!bt.states) continue
      const statesObj = bt.states as Record<string, unknown>
      const itfObj: Record<string, unknown> = {
        "#meta": statesObj["#meta"],
        vars: statesObj["vars"],
        states: statesObj["states"]
      }
      // Convert BigInts (from our integer-to-bigint reviver) to ITF #bigint encoding
      const itfContent = JSON.stringify(itfObj, (_key, value) =>
        typeof value === "bigint" ? { "#bigint": String(value) } : value
      )
      const filePath = join(outDir, `trace_${i}.itf.json`)
      yield* Effect.tryPromise({
        try: () => writeFile(filePath, itfContent),
        catch: (e) => new QuintError({ message: `Failed to write trace file: ${e}` })
      })
    }

    // Read the trace files back using the standard ITF parser
    const files = yield* Effect.tryPromise({
      try: () => readdir(outDir),
      catch: (e) => new QuintError({ message: `Failed to read trace directory: ${e}` })
    })
    const traceFiles = files.filter((f: string) => f.endsWith(".itf.json")).sort()
    for (const file of traceFiles) {
      const content = yield* Effect.tryPromise({
        try: () => readFile(join(outDir, file), "utf-8"),
        catch: (e) => new QuintError({ message: `Failed to read trace file ${file}: ${e}` })
      })
      const json: unknown = yield* Effect.try({
        try: () => JSON.parse(content),
        catch: (e) => new QuintError({ message: `Invalid JSON in trace file ${file}: ${e}` })
      })
      const trace = yield* Effect.mapError(
        Schema.decodeUnknown(ItfTrace)(json),
        (e) => new QuintError({ message: `Failed to parse ITF trace ${file}: ${e}` })
      )
      traces.push(trace)
    }

    return traces
  })

// ---------------------------------------------------------------------------
// Standard path: call `quint run` CLI
// ---------------------------------------------------------------------------

const runAndReadTraces = (
  opts: RunOptions,
  outDir: string
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> =>
  Effect.gen(function*() {
    const args = buildRunArgs(opts, outDir)
    const { exitCode, stderr } = yield* runQuintProcess(args, opts.verbose === true)
    if (exitCode !== 0) {
      return yield* new QuintError({
        message: stderr
          ? `quint run failed with exit code ${exitCode}:\n${stderr.trim()}`
          : `quint run failed with exit code ${exitCode}`,
        stderr,
        exitCode
      })
    }
    const files = yield* Effect.tryPromise({
      try: () => readdir(outDir),
      catch: (e) => new QuintError({ message: `Failed to read trace directory: ${e}` })
    })
    const traceFiles = files
      .filter((f: string) => f.endsWith(".itf.json"))
      .sort()
    const traces: Array<ItfTrace> = []
    for (const file of traceFiles) {
      const content = yield* Effect.tryPromise({
        try: () => readFile(join(outDir, file), "utf-8"),
        catch: (e) => new QuintError({ message: `Failed to read trace file ${file}: ${e}` })
      })
      const json: unknown = yield* Effect.try({
        try: () => JSON.parse(content),
        catch: (e) => new QuintError({ message: `Invalid JSON in trace file ${file}: ${e}` })
      })
      const trace = yield* Effect.mapError(
        Schema.decodeUnknown(ItfTrace)(json),
        (e) => new QuintError({ message: `Failed to parse ITF trace ${file}: ${e}` })
      )
      traces.push(trace)
    }
    return traces
  })

// ---------------------------------------------------------------------------
// Dispatch: use compiled input path if available, otherwise standard path
// ---------------------------------------------------------------------------

const generateTracesInDir = (
  opts: RunOptions,
  outDir: string
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> => {
  if (opts.compiledInput && existsSync(opts.compiledInput)) {
    return runFromCompiledInput(opts.compiledInput, opts, outDir)
  }
  return runAndReadTraces(opts, outDir)
}

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

export const generateTraces = (
  opts: RunOptions
): Effect.Effect<ReadonlyArray<ItfTrace>, QuintError | QuintNotFoundError> =>
  opts.traceDir !== undefined
    ? generateTracesWithTraceDir(opts, opts.traceDir)
    : generateTracesWithTempDir(opts)
