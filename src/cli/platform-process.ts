import { Effect, Option, Schema } from "effect"
import { execFile } from "node:child_process"

interface ProcessHandle {
  readonly pid?: number | undefined
}

interface CommandHandle {
  readonly kill: () => unknown
}

type RunCommand = (
  command: string,
  args: ReadonlyArray<string>,
  callback: (error: Error | null, stdout: string) => void
) => CommandHandle

// eslint-disable-next-line functional/no-mixed-types -- injected process operations include platform data.
interface PlatformProcessDeps {
  readonly platform: NodeJS.Platform
  readonly runCommand: RunCommand
  readonly killProcess: (pid: number, signal: NodeJS.Signals) => unknown
  readonly addExitListener: (listener: () => void) => void
  readonly removeExitListener: (listener: () => void) => void
}

const defaultRunCommand: RunCommand = (command, args, callback) =>
  execFile(command, [...args], { encoding: "utf8", windowsHide: true }, callback)

const defaultDeps: PlatformProcessDeps = {
  platform: process.platform,
  runCommand: defaultRunCommand,
  killProcess: (pid, signal) => process.kill(pid, signal),
  addExitListener: (listener) => process.on("exit", listener),
  removeExitListener: (listener) => process.removeListener("exit", listener)
}

const ProcessCount = Schema.NumberFromString
const WindowsTasklistRow = Schema.String.check(Schema.isPattern(
  /^"quint_evaluator\.exe","[0-9]+","(?:[^"]|"")*","[0-9]+","(?:[^"]|"")*"$/iu
))
const WindowsTasklistRows = Schema.Array(WindowsTasklistRow)

const parsePosixProcessCount = (stdout: string): number => {
  const decoded = Schema.decodeUnknownOption(ProcessCount)(stdout.trim())
  return Option.isSome(decoded) ? decoded.value : 0
}

const parseWindowsProcessCount = (stdout: string): number => {
  const rows = stdout
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
  const decoded = Schema.decodeUnknownOption(WindowsTasklistRows)(rows)
  return Option.isSome(decoded) ? decoded.value.length : 0
}

// eslint-disable-next-line functional/no-mixed-types -- the boundary exposes platform decisions and operations together.
export interface PlatformProcessBoundary {
  readonly commandName: (name: string) => string
  readonly executableName: (name: string) => string
  readonly detached: boolean
  readonly makeLifecycle: (
    getActiveProcess: () => ProcessHandle
  ) => { readonly complete: () => void; readonly interrupt: Effect.Effect<void> }
  readonly countEvaluatorProcesses: Effect.Effect<number>
  readonly evaluatorCleanupHint: string
}

export const makePlatformProcessBoundary = (
  deps: PlatformProcessDeps = defaultDeps
): PlatformProcessBoundary => {
  const isWindows = deps.platform === "win32"

  const terminateImmediately = (processHandle: ProcessHandle): void => {
    if (processHandle.pid === undefined) {
      return
    }
    try {
      deps.killProcess(isWindows ? processHandle.pid : -processHandle.pid, "SIGKILL")
    } catch {
      // The process has already exited.
    }
  }

  const terminateTree = (processHandle: ProcessHandle): Effect.Effect<void> => {
    if (processHandle.pid === undefined) {
      return Effect.void
    }
    if (!isWindows) {
      return Effect.sync(() => terminateImmediately(processHandle))
    }
    return Effect.callback<void>((resume) => {
      const command = deps.runCommand(
        "taskkill",
        ["/PID", String(processHandle.pid), "/T", "/F"],
        () => resume(Effect.void)
      )
      return Effect.sync(() => {
        command.kill()
        terminateImmediately(processHandle)
      })
    })
  }

  const makeLifecycle = (getActiveProcess: () => ProcessHandle) => {
    const terminateOnExit = () => terminateImmediately(getActiveProcess())
    let completed = false
    const complete = () => {
      if (!completed) {
        completed = true
        deps.removeExitListener(terminateOnExit)
      }
    }
    deps.addExitListener(terminateOnExit)

    return {
      complete,
      interrupt: Effect.gen(function*() {
        complete()
        yield* terminateTree(getActiveProcess())
      })
    }
  }

  const countEvaluatorProcesses = Effect.callback<number>((resume) => {
    const command = deps.runCommand(
      isWindows ? "tasklist" : "pgrep",
      isWindows
        ? ["/FI", "IMAGENAME eq quint_evaluator.exe", "/FO", "CSV", "/NH"]
        : ["-c", "quint_evaluator"],
      (error, stdout) => {
        if (error !== null) {
          resume(Effect.succeed(0))
          return
        }
        resume(Effect.succeed(
          isWindows ? parseWindowsProcessCount(stdout) : parsePosixProcessCount(stdout)
        ))
      }
    )
    return Effect.sync(() => command.kill())
  })

  return {
    commandName: (name) => isWindows ? `${name}.cmd` : name,
    executableName: (name) => isWindows ? `${name}.exe` : name,
    detached: !isWindows,
    makeLifecycle,
    countEvaluatorProcesses,
    evaluatorCleanupHint: isWindows
      ? "taskkill /F /T /IM quint_evaluator.exe"
      : "killall -9 quint_evaluator"
  }
}

export const platformProcess = makePlatformProcessBoundary()
