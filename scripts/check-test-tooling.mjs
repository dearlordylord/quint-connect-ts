import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"

const expectedQuintVersion = "0.32.0"
const packageJsonUrl = new URL("../node_modules/@informalsystems/quint/package.json", import.meta.url)

const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"))
if (packageJson.version !== expectedQuintVersion) {
  throw new Error(`Expected local Quint ${expectedQuintVersion}, found ${String(packageJson.version)}`)
}

const executable = process.platform === "win32" ? "quint.cmd" : "quint"
const result = spawnSync(executable, ["--version"], {
  encoding: "utf8",
  shell: process.platform === "win32"
})
if (result.error !== undefined) {
  throw result.error
}
if (result.status !== 0) {
  throw new Error(`Local Quint exited with status ${String(result.status)}: ${result.stderr.trim()}`)
}
if (result.stdout.trim() !== expectedQuintVersion) {
  throw new Error(`Expected Quint CLI ${expectedQuintVersion}, received ${result.stdout.trim()}`)
}

console.log(`Local Quint CLI ${expectedQuintVersion} is ready`)
