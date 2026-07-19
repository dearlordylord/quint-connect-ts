import { Effect, Option, Schema } from "effect"

import type { PlatformProcessBoundary } from "./platform-process.js"

// eslint-disable-next-line functional/no-mixed-types -- child-process handles combine data and event methods.
interface ManagedProcess {
  readonly pid?: number | undefined
  readonly on: {
    (event: "close", listener: (code: number | null) => void): unknown
    (event: "error", listener: (error: Error) => void): unknown
  }
}

class ProcessStartError extends Schema.TaggedError<ProcessStartError>()("ProcessStartError", {
  message: Schema.String,
  code: Schema.optional(Schema.String)
}) {}

// Intentional TypeScript difference: Rust preserves std::io::Error through anyhow
// context. Node event payloads are an untrusted JS boundary, so retain the comparable
// message/OS code without leaking `unknown` into the Effect error channel.
// https://github.com/informalsystems/quint-connect/blob/4f018f54fc7dd4cef341d10111427bab59d3b307/connect/src/trace/generator/mod.rs#L23-L30
const ProcessError = Schema.Struct({
  message: Schema.String,
  code: Schema.optional(Schema.String)
})

const processStartError = (cause: unknown): ProcessStartError => {
  const decoded = Schema.decodeUnknownOption(ProcessError)(cause)
  return Option.isSome(decoded)
    ? new ProcessStartError(decoded.value)
    : new ProcessStartError({ message: String(cause) })
}

// eslint-disable-next-line functional/no-mixed-types -- lifecycle setup combines process data and callbacks.
interface ManagedProcessOptions<Process extends ManagedProcess, Result> {
  readonly processBoundary: PlatformProcessBoundary
  readonly spawn: () => Process
  readonly captureResult: (process: Process) => (exitCode: number) => Result
}

/**
 * Owns one child-process attempt from spawn through close, startup error, or interruption.
 *
 * Rust performs one blocking `Command::output` call and keeps the trace directory alive
 * through `TempDir` ownership. Node exposes asynchronous close/error events instead, so
 * this adapter uses an Effect scope as the corresponding resource-ownership boundary.
 * https://github.com/informalsystems/quint-connect/blob/4f018f54fc7dd4cef341d10111427bab59d3b307/connect/src/trace/generator/mod.rs#L23-L33
 */
export const runManagedProcess = <Process extends ManagedProcess, Result>(
  options: ManagedProcessOptions<Process, Result>
): Effect.Effect<Result, ProcessStartError> =>
  Effect.scoped(
    Effect.gen(function*() {
      const { lifecycle, process } = yield* Effect.acquireRelease(
        Effect.try({ try: options.spawn, catch: processStartError }).pipe(
          Effect.map((process) => ({
            lifecycle: options.processBoundary.makeLifecycle(() => process),
            process
          }))
        ),
        ({ lifecycle }) => lifecycle.interrupt
      )
      const makeResult = yield* Effect.try({
        try: () => options.captureResult(process),
        catch: processStartError
      })
      return yield* Effect.async<Result, ProcessStartError>((resume) => {
        process.on("close", (code) => {
          lifecycle.complete()
          resume(Effect.succeed(makeResult(code ?? 1)))
        })
        process.on("error", (cause) => {
          const error = processStartError(cause)
          // Node-only decision: unlike Rust's blocking `Command::output`, an `error`
          // event is not proof that an already-created child has exited. ENOENT means
          // spawn never created one; otherwise the open scope retains ownership and its
          // finalizer terminates any possibly-live process tree.
          // Rust comparison:
          // https://github.com/informalsystems/quint-connect/blob/4f018f54fc7dd4cef341d10111427bab59d3b307/connect/src/trace/generator/mod.rs#L23-L30
          // Node event contract: https://nodejs.org/api/child_process.html#event-error
          if (error.code === "ENOENT") {
            lifecycle.complete()
          }
          resume(Effect.fail(error))
        })
        return Effect.void
      })
    })
  )
