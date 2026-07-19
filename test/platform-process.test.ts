import { Effect, Fiber } from "effect"
import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"

import { makeRunEvaluatorProcess } from "../src/cli/compiled-evaluator-adapter.js"
import { runManagedProcess } from "../src/cli/managed-process.js"
import { makePlatformProcessBoundary } from "../src/cli/platform-process.js"
import { makeRunQuintProcess } from "../src/cli/quint-cli-adapter.js"

// eslint-disable-next-line functional/no-mixed-types -- test command handles mix captured data with cancellation.
interface PendingCommand {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly callback: (error: Error | null, stdout: string) => void
  readonly kill: ReturnType<typeof vi.fn>
}

const makeBoundary = (platform: NodeJS.Platform) => {
  const commands: Array<PendingCommand> = []
  const killProcess = vi.fn()
  const runCommandSync = vi.fn(() => true)
  const exitListeners: Array<() => void> = []
  const signalListeners = new Map<NodeJS.Signals, Array<() => void>>()
  const removeExitListener = vi.fn((listener: () => void) => {
    const index = exitListeners.indexOf(listener)
    if (index >= 0) {
      exitListeners.splice(index, 1)
    }
  })
  const removeSignalListener = vi.fn((signal: NodeJS.Signals, listener: () => void) => {
    const listeners = signalListeners.get(signal) ?? []
    signalListeners.set(signal, listeners.filter((registered) => registered !== listener))
  })
  const signalSelf = vi.fn()
  const boundary = makePlatformProcessBoundary({
    platform,
    runCommand: (command, args, callback) => {
      const pending = { command, args, callback, kill: vi.fn() }
      commands.push(pending)
      return pending
    },
    runCommandSync,
    killProcess,
    addExitListener: (listener) => exitListeners.push(listener),
    removeExitListener,
    addSignalListener: (signal, listener) => {
      const listeners = signalListeners.get(signal) ?? []
      signalListeners.set(signal, [...listeners, listener])
    },
    removeSignalListener,
    signalSelf
  })
  return {
    boundary,
    commands,
    exitListeners,
    killProcess,
    removeExitListener,
    removeSignalListener,
    runCommandSync,
    signalListeners,
    signalSelf
  }
}

class FakeProcess extends EventEmitter {
  readonly stdout = { resume: vi.fn() }
  readonly stderr = new EventEmitter()

  constructor(readonly pid: number) {
    super()
  }
}

class FakeEvaluatorProcess extends EventEmitter {
  readonly stdin = { write: vi.fn(), end: vi.fn() }
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()

  constructor(readonly pid: number) {
    super()
  }
}

describe("platform process boundary", () => {
  it("reports a synchronous spawn failure without installing lifecycle hooks", async () => {
    const platform = makeBoundary("linux")
    const result = Effect.runPromise(
      runManagedProcess({
        processBoundary: platform.boundary,
        spawn: () => {
          throw new Error("spawn failed synchronously")
        },
        captureResult: () => () => undefined
      }).pipe(Effect.flip)
    )

    await expect(result).resolves.toMatchObject({
      _tag: "ProcessStartError",
      message: "spawn failed synchronously"
    })
    expect(platform.exitListeners).toEqual([])
    expect(platform.killProcess).not.toHaveBeenCalled()
  })
  it("shares close, startup-error, and lifecycle handling across subprocess adapters", async () => {
    const platform = makeBoundary("linux")
    const completed = new FakeProcess(90)
    const completedResult = Effect.runPromise(runManagedProcess({
      processBoundary: platform.boundary,
      spawn: () => completed,
      captureResult: (process) => {
        process.stderr.on("data", () => undefined)
        return (exitCode) => ({ exitCode })
      }
    }))

    completed.emit("close", 0)
    await expect(completedResult).resolves.toEqual({ exitCode: 0 })
    expect(platform.exitListeners).toEqual([])

    const failed = new FakeProcess(91)
    const failedResult = Effect.runPromise(
      runManagedProcess({
        processBoundary: platform.boundary,
        spawn: () => failed,
        captureResult: () => () => undefined
      }).pipe(Effect.flip)
    )
    failed.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }))

    await expect(failedResult).resolves.toMatchObject({
      _tag: "ProcessStartError",
      code: "ENOENT",
      message: "missing"
    })
    expect(platform.exitListeners).toEqual([])
  })

  it("kills a spawned process when result capture throws synchronously", async () => {
    const platform = makeBoundary("linux")
    const child = new FakeProcess(92)

    await expect(Effect.runPromise(
      runManagedProcess({
        processBoundary: platform.boundary,
        spawn: () => child,
        captureResult: () => {
          throw new Error("failed to attach stdio")
        }
      }).pipe(Effect.flip)
    )).resolves.toMatchObject({
      _tag: "ProcessStartError",
      message: "failed to attach stdio"
    })

    expect(platform.killProcess).toHaveBeenCalledWith(-92, "SIGKILL")
    expect(platform.exitListeners).toEqual([])
  })

  it("kills a possibly-live process after a non-spawn error event", async () => {
    const platform = makeBoundary("linux")
    const child = new FakeProcess(93)
    const result = Effect.runPromise(
      runManagedProcess({
        processBoundary: platform.boundary,
        spawn: () => child,
        captureResult: () => () => undefined
      }).pipe(Effect.flip)
    )

    child.emit("error", new Error("process channel failed"))

    await expect(result).resolves.toMatchObject({
      _tag: "ProcessStartError",
      message: "process channel failed"
    })
    expect(platform.killProcess).toHaveBeenCalledWith(-93, "SIGKILL")
    expect(platform.exitListeners).toEqual([])
  })

  it("settles close/error races once without killing a normally closed process", async () => {
    const platform = makeBoundary("linux")
    const child = new FakeProcess(94)
    const result = Effect.runPromise(runManagedProcess({
      processBoundary: platform.boundary,
      spawn: () => child,
      captureResult: () => (exitCode) => exitCode
    }))

    child.emit("close", 0)
    child.emit("error", new Error("late channel error"))

    await expect(result).resolves.toBe(0)
    expect(platform.killProcess).not.toHaveBeenCalled()
    expect(platform.exitListeners).toEqual([])
  })

  it("settles error/close races once and releases lifecycle hooks", async () => {
    const platform = makeBoundary("linux")
    const child = new FakeProcess(95)
    const result = Effect.runPromise(
      runManagedProcess({
        processBoundary: platform.boundary,
        spawn: () => child,
        captureResult: () => (exitCode) => exitCode
      }).pipe(Effect.flip)
    )

    child.emit("error", new Error("channel failed first"))
    child.emit("close", 1)

    await expect(result).resolves.toMatchObject({
      _tag: "ProcessStartError",
      message: "channel failed first"
    })
    expect(platform.exitListeners).toEqual([])
  })
  it("selects POSIX command names, evaluator names, and detached process groups", () => {
    const { boundary } = makeBoundary("linux")

    expect(boundary.commandName("quint")).toBe("quint")
    expect(boundary.commandName("npx")).toBe("npx")
    expect(boundary.executableName("quint_evaluator")).toBe("quint_evaluator")
    expect(boundary.detached).toBe(true)
    expect(boundary.evaluatorCleanupHint).toBe("killall -9 quint_evaluator")
  })

  it("selects Windows command shims, evaluator names, and attached processes", () => {
    const { boundary } = makeBoundary("win32")

    expect(boundary.commandName("quint")).toBe("quint.cmd")
    expect(boundary.commandName("npx")).toBe("npx.cmd")
    expect(boundary.executableName("quint_evaluator")).toBe("quint_evaluator.exe")
    expect(boundary.detached).toBe(false)
    expect(boundary.evaluatorCleanupHint).toBe("taskkill /F /T /IM quint_evaluator.exe")
  })

  it("falls back from quint.cmd to npx.cmd on Windows", async () => {
    const { boundary } = makeBoundary("win32")
    const spawned: Array<{
      readonly args: ReadonlyArray<string>
      readonly command: string
      readonly process: FakeProcess
    }> = []
    const run = makeRunQuintProcess((command, args) => {
      const child = new FakeProcess(100 + spawned.length)
      spawned.push({ args, command, process: child })
      return child
    }, boundary)
    const quintArgs = ["run", "counter & model.qnt", "--seed", "0x2a"]
    const result = Effect.runPromise(run(quintArgs, false))

    spawned[0]?.process.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }))
    spawned[0]?.process.emit("close", 1)
    await vi.waitFor(() => expect(spawned).toHaveLength(2))
    spawned[1]?.process.emit("close", 0)

    await expect(result).resolves.toEqual({ exitCode: 0, stderr: "" })
    expect(spawned.map(({ command }) => command)).toEqual(["quint.cmd", "npx.cmd"])
    expect(spawned[0]?.args).toEqual(quintArgs)
    expect(spawned[1]?.args).toEqual(["@informalsystems/quint", ...quintArgs])
  })

  it("targets the replacement npx process when fallback execution is interrupted", async () => {
    const platform = makeBoundary("win32")
    const spawned: Array<FakeProcess> = []
    const run = makeRunQuintProcess(() => {
      const child = new FakeProcess(200 + spawned.length)
      spawned.push(child)
      return child
    }, platform.boundary)
    const fiber = Effect.runFork(run(["run", "counter.qnt"], false))

    spawned[0]?.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }))
    await vi.waitFor(() => expect(spawned).toHaveLength(2))
    const interrupted = Effect.runPromise(Fiber.interrupt(fiber))
    await vi.waitFor(() => expect(platform.commands).toHaveLength(1))

    expect(platform.commands[0]).toMatchObject({
      command: "taskkill",
      args: ["/PID", "201", "/T", "/F"]
    })
    platform.commands[0]?.callback(null, "")
    await interrupted
  })

  it("removes its exit listener after normal completion", async () => {
    const platform = makeBoundary("linux")
    const child = new FakeProcess(300)
    const run = makeRunQuintProcess(() => child, platform.boundary)
    const result = Effect.runPromise(run(["run", "counter.qnt"], false))

    child.emit("close", 0)

    await expect(result).resolves.toEqual({ exitCode: 0, stderr: "" })
    expect(platform.exitListeners).toEqual([])
    expect(platform.signalListeners.get("SIGINT")).toEqual([])
    expect(platform.signalListeners.get("SIGTERM")).toEqual([])
    expect(platform.removeExitListener).toHaveBeenCalledOnce()
    expect(platform.killProcess).not.toHaveBeenCalled()
  })

  it("removes its exit listener after a handled startup failure", async () => {
    const platform = makeBoundary("linux")
    const child = new FakeProcess(301)
    const run = makeRunQuintProcess(() => child, platform.boundary)
    const result = Effect.runPromise(run(["run", "counter.qnt"], false))

    child.emit("error", new Error("permission denied"))

    await expect(result).rejects.toThrow("Failed to start quint")
    expect(platform.exitListeners).toEqual([])
    expect(platform.signalListeners.get("SIGINT")).toEqual([])
    expect(platform.signalListeners.get("SIGTERM")).toEqual([])
    expect(platform.removeExitListener).toHaveBeenCalledOnce()
  })

  it("terminates a POSIX process group when interrupted", async () => {
    const platform = makeBoundary("linux")
    const { boundary, killProcess, removeExitListener } = platform
    const lifecycle = boundary.makeLifecycle(() => ({ pid: 42 }))

    await Effect.runPromise(lifecycle.interrupt)

    expect(killProcess).toHaveBeenCalledWith(-42, "SIGKILL")
    expect(removeExitListener).toHaveBeenCalledOnce()
    expect(platform.signalListeners.get("SIGINT")).toEqual([])
    expect(platform.signalListeners.get("SIGTERM")).toEqual([])
  })

  it("terminates a process tree at most once across repeated cleanup", async () => {
    const platform = makeBoundary("linux")
    const lifecycle = platform.boundary.makeLifecycle(() => ({ pid: 44 }))

    await Effect.runPromise(lifecycle.interrupt)
    await Effect.runPromise(lifecycle.interrupt)
    lifecycle.complete()

    expect(platform.killProcess).toHaveBeenCalledTimes(1)
    expect(platform.killProcess).toHaveBeenCalledWith(-44, "SIGKILL")
    expect(platform.removeExitListener).toHaveBeenCalledTimes(1)
  })

  it("terminates a Windows process tree with taskkill when interrupted", async () => {
    const { boundary, commands, removeExitListener } = makeBoundary("win32")
    const lifecycle = boundary.makeLifecycle(() => ({ pid: 43 }))
    const interrupted = Effect.runPromise(lifecycle.interrupt)

    expect(commands[0]).toMatchObject({
      command: "taskkill",
      args: ["/PID", "43", "/T", "/F"]
    })
    commands[0]?.callback(null, "")
    await interrupted

    expect(removeExitListener).toHaveBeenCalledOnce()
  })

  it("falls back to the direct Windows process when taskkill fails", async () => {
    const { boundary, commands, killProcess } = makeBoundary("win32")
    const lifecycle = boundary.makeLifecycle(() => ({ pid: 47 }))
    const interrupted = Effect.runPromise(lifecycle.interrupt)

    commands[0]?.callback(new Error("taskkill unavailable"), "")
    await interrupted

    expect(killProcess).toHaveBeenCalledWith(47, "SIGKILL")
  })

  it("runs the compiled evaluator with portable Windows lifecycle settings", async () => {
    const { boundary, commands } = makeBoundary("win32")
    const process = new FakeEvaluatorProcess(46)
    const spawnProcess = vi.fn(() => process)
    const fiber = Effect.runFork(
      makeRunEvaluatorProcess(spawnProcess, boundary)("C:\\quint_evaluator.exe", "{}")
    )
    const interrupted = Effect.runPromise(Fiber.interrupt(fiber))
    await vi.waitFor(() => expect(commands).toHaveLength(1))

    expect(spawnProcess).toHaveBeenCalledWith(
      "C:\\quint_evaluator.exe",
      ["simulate-from-stdin"],
      { stdio: ["pipe", "pipe", "pipe"], detached: false }
    )
    expect(commands[0]).toMatchObject({ command: "taskkill", args: ["/PID", "46", "/T", "/F"] })
    commands[0]?.callback(null, "")
    await interrupted
  })

  it("removes the compiled evaluator exit listener after a handled startup failure", async () => {
    const platform = makeBoundary("linux")
    const process = new FakeEvaluatorProcess(49)
    const run = makeRunEvaluatorProcess(() => process, platform.boundary)
    const result = Effect.runPromise(run("/quint_evaluator", "{}"))

    process.emit("error", new Error("not executable"))

    await expect(result).rejects.toThrow("Failed to start Rust evaluator")
    expect(platform.exitListeners).toEqual([])
    expect(platform.removeExitListener).toHaveBeenCalledOnce()
  })

  it("uses synchronous best-effort cleanup when the host exits", () => {
    const posix = makeBoundary("linux")
    const windows = makeBoundary("win32")
    posix.boundary.makeLifecycle(() => ({ pid: 44 }))
    windows.boundary.makeLifecycle(() => ({ pid: 45 }))

    posix.exitListeners[0]?.()
    windows.exitListeners[0]?.()

    expect(posix.killProcess).toHaveBeenCalledWith(-44, "SIGKILL")
    expect(windows.runCommandSync).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "45", "/T", "/F"]
    )
    expect(windows.killProcess).not.toHaveBeenCalled()
  })

  it("falls back to direct Windows cleanup when shutdown taskkill fails", () => {
    const windows = makeBoundary("win32")
    windows.runCommandSync.mockReturnValue(false)
    windows.boundary.makeLifecycle(() => ({ pid: 48 }))

    windows.exitListeners[0]?.()

    expect(windows.killProcess).toHaveBeenCalledWith(48, "SIGKILL")
  })

  it("cleans a POSIX process group on SIGINT before restoring signal termination", () => {
    const posix = makeBoundary("linux")
    posix.boundary.makeLifecycle(() => ({ pid: 51 }))
    posix.signalSelf.mockImplementation(() => {
      expect(posix.exitListeners).toEqual([])
      expect(posix.signalListeners.get("SIGINT")).toEqual([])
      expect(posix.signalListeners.get("SIGTERM")).toEqual([])
    })

    posix.signalListeners.get("SIGINT")?.[0]?.()

    expect(posix.killProcess).toHaveBeenCalledWith(-51, "SIGKILL")
    expect(posix.signalSelf).toHaveBeenCalledOnce()
    expect(posix.signalSelf).toHaveBeenCalledWith("SIGINT")
  })

  it("cleans a Windows process tree on SIGTERM before restoring signal termination", () => {
    const windows = makeBoundary("win32")
    windows.boundary.makeLifecycle(() => ({ pid: 52 }))
    windows.signalSelf.mockImplementation(() => {
      expect(windows.exitListeners).toEqual([])
      expect(windows.signalListeners.get("SIGINT")).toEqual([])
      expect(windows.signalListeners.get("SIGTERM")).toEqual([])
    })

    windows.signalListeners.get("SIGTERM")?.[0]?.()

    expect(windows.runCommandSync).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "52", "/T", "/F"]
    )
    expect(windows.signalSelf).toHaveBeenCalledOnce()
    expect(windows.signalSelf).toHaveBeenCalledWith("SIGTERM")
    expect(windows.killProcess).not.toHaveBeenCalled()
  })

  it("tolerates a direct process that has already exited", async () => {
    const posix = makeBoundary("linux")
    posix.killProcess.mockImplementation(() => {
      throw new Error("ESRCH")
    })
    const lifecycle = posix.boundary.makeLifecycle(() => ({ pid: 50 }))

    await expect(Effect.runPromise(lifecycle.interrupt)).resolves.toBeUndefined()
  })

  it("counts evaluator processes asynchronously on POSIX and Windows", async () => {
    const posix = makeBoundary("linux")
    const windows = makeBoundary("win32")
    const posixCount = Effect.runPromise(posix.boundary.countEvaluatorProcesses)
    const windowsCount = Effect.runPromise(windows.boundary.countEvaluatorProcesses)

    expect(posix.commands[0]).toMatchObject({ command: "pgrep", args: ["-c", "quint_evaluator"] })
    expect(windows.commands[0]).toMatchObject({
      command: "tasklist",
      args: ["/FI", "IMAGENAME eq quint_evaluator.exe", "/FO", "CSV", "/NH"]
    })
    posix.commands[0]?.callback(null, "2\n")
    windows.commands[0]?.callback(
      null,
      [
        "\"quint_evaluator.exe\",\"100\",\"Console\",\"1\",\"10,000 K\"",
        "\"quint_evaluator.exe\",\"101\",\"Console\",\"1\",\"10,000 K\""
      ].join("\r\n")
    )

    await expect(posixCount).resolves.toBe(2)
    await expect(windowsCount).resolves.toBe(2)
  })

  it("does not trust a partial count when a Windows tasklist row is malformed", async () => {
    const windows = makeBoundary("win32")
    const count = Effect.runPromise(windows.boundary.countEvaluatorProcesses)

    windows.commands[0]?.callback(
      null,
      [
        "\"quint_evaluator.exe\",\"100\",\"Console\",\"1\",\"10,000 K\"",
        "\"quint_evaluator.exe\",not-a-pid"
      ].join("\r\n")
    )

    await expect(count).resolves.toBe(0)
  })

  it("treats unexpected Windows tasklist output as no trusted matches", async () => {
    const windows = makeBoundary("win32")
    const count = Effect.runPromise(windows.boundary.countEvaluatorProcesses)

    windows.commands[0]?.callback(
      null,
      "INFO: No tasks are running which match the specified criteria."
    )

    await expect(count).resolves.toBe(0)
  })

  it("cancels an in-flight zombie check without waiting for the OS command", async () => {
    const { boundary, commands } = makeBoundary("win32")
    const fiber = Effect.runFork(boundary.countEvaluatorProcesses)

    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(commands[0]?.kill).toHaveBeenCalledOnce()
  })
})
