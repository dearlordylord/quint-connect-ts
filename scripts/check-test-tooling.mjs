import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { Effect, Schema } from "effect"

class ToolingCheckError extends Schema.TaggedError()("ToolingCheckError", {
  message: Schema.String
}) {}

const expectedQuintVersion = "0.32.0"
const packageJsonUrl = new URL("../node_modules/@informalsystems/quint/package.json", import.meta.url)
const QuintManifest = Schema.parseJson(Schema.Struct({ version: Schema.String }))
const SpawnResult = Schema.Struct({
  error: Schema.optional(Schema.instanceOf(Error)),
  status: Schema.NullOr(Schema.Number),
  stderr: Schema.NullOr(Schema.String),
  stdout: Schema.NullOr(Schema.String)
})
const toolingError = (message) => new ToolingCheckError({ message })

const program = Effect.gen(function*() {
  const source = yield* Effect.tryPromise({
    try: () => readFile(packageJsonUrl, "utf8"),
    catch: (cause) => toolingError(`Failed to read local Quint manifest: ${String(cause)}`)
  })
  const packageJson = yield* Schema.decodeUnknown(QuintManifest)(source).pipe(
    Effect.mapError((cause) => toolingError(`Invalid local Quint manifest: ${String(cause)}`))
  )
  if (packageJson.version !== expectedQuintVersion) {
    return yield* toolingError(
      `Expected local Quint ${expectedQuintVersion}, found ${String(packageJson.version)}`
    )
  }

  const executable = process.platform === "win32" ? "quint.cmd" : "quint"
  const rawResult = yield* Effect.try({
    try: () => spawnSync(executable, ["--version"], {
      encoding: "utf8",
      shell: process.platform === "win32"
    }),
    catch: (cause) => toolingError(`Failed to start local Quint: ${String(cause)}`)
  })
  const result = yield* Schema.decodeUnknown(SpawnResult)(rawResult).pipe(
    Effect.mapError((cause) => toolingError(`Invalid Quint process result: ${String(cause)}`))
  )
  if (result.error !== undefined) {
    return yield* toolingError(`Failed to start local Quint: ${result.error.message}`)
  }
  if (result.status !== 0) {
    return yield* toolingError(
      `Local Quint exited with status ${String(result.status)}: ${result.stderr?.trim() ?? ""}`
    )
  }
  if (result.stdout?.trim() !== expectedQuintVersion) {
    return yield* toolingError(
      `Expected Quint CLI ${expectedQuintVersion}, received ${result.stdout?.trim() ?? ""}`
    )
  }

  console.log(`Local Quint CLI ${expectedQuintVersion} is ready`)
})

await Effect.runPromise(program)
