// Controlled long-running process-tree fixture for real-Windows lifecycle tests.
//
// Spawns one long-sleeping grandchild, records both PIDs to the file given as argv[2],
// then keeps itself alive. The Windows lifecycle test drives `taskkill /T /F` against
// this parent PID and asserts the whole tree is gone. Kept dependency-free so it runs
// identically under Node on any host.
import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"

const outFile = process.argv[2]
if (outFile === undefined) {
  throw new Error("windows-process-tree fixture requires an output file path")
}

const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], {
  stdio: "ignore"
})

child.on("spawn", () => {
  writeFileSync(outFile, JSON.stringify({ child: child.pid, parent: process.pid }))
})

// Keep the parent alive until the test terminates the tree.
setTimeout(() => {}, 120000)
