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

/** Owns one child-process attempt from spawn through close, startup error, or interruption. */
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
          if (error.code === "ENOENT") {
            lifecycle.complete()
          }
          resume(Effect.fail(error))
        })
        return Effect.void
      })
    })
  )
