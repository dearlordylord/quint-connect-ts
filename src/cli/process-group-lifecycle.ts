import { Effect } from "effect"

interface ProcessGroup {
  readonly pid?: number | undefined
}

const killProcessGroup = (processGroup: ProcessGroup): void => {
  try {
    if (processGroup.pid !== undefined) {
      process.kill(-processGroup.pid, "SIGKILL")
    }
  } catch {
    // The process group has already exited.
  }
}

export const makeProcessGroupLifecycle = (
  getActiveProcess: () => ProcessGroup
): { readonly complete: () => void; readonly interrupt: Effect.Effect<void> } => {
  const killActiveProcess = () => killProcessGroup(getActiveProcess())
  const complete = () => process.removeListener("exit", killActiveProcess)
  process.on("exit", killActiveProcess)

  return {
    complete,
    interrupt: Effect.sync(() => {
      complete()
      killActiveProcess()
    })
  }
}
