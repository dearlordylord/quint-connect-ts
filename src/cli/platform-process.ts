import { Effect, Option, Schema } from "effect"
import { execFile, spawnSync } from "node:child_process"

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

type RunCommandSync = (
  command: string,
  args: ReadonlyArray<string>
) => boolean

// eslint-disable-next-line functional/no-mixed-types -- injected process operations include platform data.
interface PlatformProcessDeps {
  readonly platform: NodeJS.Platform
  readonly runCommand: RunCommand
  readonly runCommandSync: RunCommandSync
  readonly killProcess: (pid: number, signal: NodeJS.Signals) => unknown
  readonly addExitListener: (listener: () => void) => void
  readonly removeExitListener: (listener: () => void) => void
  readonly addSignalListener: (signal: NodeJS.Signals, listener: () => void) => void
  readonly removeSignalListener: (signal: NodeJS.Signals, listener: () => void) => void
  readonly signalSelf: (signal: NodeJS.Signals) => void
}

const defaultRunCommand: RunCommand = (command, args, callback) =>
  execFile(command, [...args], { encoding: "utf8", windowsHide: true }, callback)

const defaultRunCommandSync: RunCommandSync = (command, args) => {
  const result = spawnSync(command, [...args], { stdio: "ignore", windowsHide: true })
  return result.error === undefined && result.status === 0
}

const interruptExitCode = 130
const terminationExitCode = 143

const signalSelf = (signal: NodeJS.Signals): void => {
  try {
    process.kill(process.pid, signal)
  } catch {
    process.exit(signal === "SIGINT" ? interruptExitCode : terminationExitCode)
  }
}

const defaultDeps: PlatformProcessDeps = {
  platform: process.platform,
  runCommand: defaultRunCommand,
  runCommandSync: defaultRunCommandSync,
  killProcess: (pid, signal) => process.kill(pid, signal),
  addExitListener: (listener) => process.on("exit", listener),
  removeExitListener: (listener) => process.removeListener("exit", listener),
  addSignalListener: (signal, listener) => process.once(signal, listener),
  removeSignalListener: (signal, listener) => process.removeListener(signal, listener),
  signalSelf
}

const ProcessCount = Schema.NumberFromString
const WindowsTasklistRow = Schema.String.pipe(Schema.pattern(
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
    return Effect.async<void>((resume) => {
      const command = deps.runCommand(
        "taskkill",
        ["/PID", String(processHandle.pid), "/T", "/F"],
        (error) => {
          if (error !== null) {
            terminateImmediately(processHandle)
          }
          resume(Effect.void)
        }
      )
      return Effect.sync(() => {
        command.kill()
        terminateImmediately(processHandle)
      })
    })
  }

  const makeLifecycle = (getActiveProcess: () => ProcessHandle) => {
    const terminateOnExit = () => {
      const activeProcess = getActiveProcess()
      if (!isWindows || activeProcess.pid === undefined) {
        terminateImmediately(activeProcess)
        return
      }
      try {
        if (
          deps.runCommandSync(
            "taskkill",
            ["/PID", String(activeProcess.pid), "/T", "/F"]
          )
        ) {
          return
        }
      } catch {
        // Fall through to direct-process cleanup when taskkill cannot start.
      }
      terminateImmediately(activeProcess)
    }
    let completed = false
    const propagateSignal = (signal: NodeJS.Signals) => {
      complete()
      terminateOnExit()
      deps.signalSelf(signal)
    }
    const onSigint = () => propagateSignal("SIGINT")
    const onSigterm = () => propagateSignal("SIGTERM")
    const complete = () => {
      if (!completed) {
        completed = true
        deps.removeExitListener(terminateOnExit)
        deps.removeSignalListener("SIGINT", onSigint)
        deps.removeSignalListener("SIGTERM", onSigterm)
      }
    }
    deps.addExitListener(terminateOnExit)
    deps.addSignalListener("SIGINT", onSigint)
    deps.addSignalListener("SIGTERM", onSigterm)

    return {
      complete,
      interrupt: Effect.gen(function*() {
        complete()
        yield* terminateTree(getActiveProcess())
      })
    }
  }

  const countEvaluatorProcesses = Effect.async<number>((resume) => {
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
