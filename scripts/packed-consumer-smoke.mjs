import { spawnSync } from "node:child_process"
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Schema } from "effect"

import { decodePackageContractManifestJson, validatePackageContract } from "./package-contract.mjs"

class PackageSmokeError extends Schema.TaggedError()("PackageSmokeError", {
  message: Schema.String
}) {}

const smokeError = (message) => new PackageSmokeError({ message })
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const RepositoryManifest = Schema.parseJson(Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  dependencies: Schema.Struct({
    "@firfi/itf-trace-parser": Schema.String,
    effect: Schema.String
  }),
  devDependencies: Schema.Struct({ zod: Schema.String })
}))
const Runtime = Schema.Literal("node", "bun")
const SpawnResult = Schema.Struct({
  error: Schema.optional(Schema.instanceOf(Error)),
  status: Schema.NullOr(Schema.Number),
  stderr: Schema.NullOr(Schema.String),
  stdout: Schema.NullOr(Schema.String)
})
const ConsumerManifest = Schema.Struct({
  name: Schema.Literal("quint-connect-packed-smoke"),
  private: Schema.Literal(true),
  type: Schema.Literal("module"),
  dependencies: Schema.Record({ key: Schema.String, value: Schema.String })
})
const ConsumerManifestJson = Schema.parseJson(ConsumerManifest)

const decode = (schema, input, label) => Schema.decodeUnknown(schema)(input).pipe(
  Effect.mapError((cause) => smokeError(`Invalid ${label}: ${String(cause)}`))
)

const fileOperation = (label, operation) => Effect.tryPromise({
  try: operation,
  catch: (cause) => smokeError(`${label}: ${String(cause)}`)
})

const verify = (condition, message) => condition ? Effect.void : Effect.fail(smokeError(message))

const spawnProcess = (command, args, options = {}) =>
  Effect.gen(function*() {
    const rawResult = yield* Effect.try({
      try: () => spawnSync(command, args, {
        cwd: options.cwd ?? repoRoot,
        encoding: "utf8",
        env: { ...process.env, ...options.env }
      }),
      catch: (cause) => smokeError(`Failed to start ${command}: ${String(cause)}`)
    })
    const result = yield* decode(SpawnResult, rawResult, `${command} process result`)
    if (result.error !== undefined) {
      return yield* smokeError(`Failed to start ${command}: ${result.error.message}`)
    }
    return result
  })

const run = (command, args, options = {}) =>
  Effect.gen(function*() {
    const result = yield* spawnProcess(command, args, options)
    if (result.status !== 0) {
      return yield* smokeError([
        `${command} ${args.join(" ")} exited with status ${String(result.status)}`,
        result.stdout,
        result.stderr
      ].filter(Boolean).join("\n"))
    }
    return result.stdout ?? ""
  })

const installConsumer = (consumerRoot, dependencies) =>
  Effect.gen(function*() {
    const manifest = yield* Schema.encode(ConsumerManifestJson)({
      name: "quint-connect-packed-smoke",
      private: true,
      type: "module",
      dependencies
    }).pipe(Effect.mapError((cause) => smokeError(`Invalid consumer manifest: ${String(cause)}`)))
    yield* fileOperation(
      "Failed to write consumer manifest",
      () => writeFile(join(consumerRoot, "package.json"), manifest)
    )
    yield* run("pnpm", [
      "install",
      "--prefer-offline",
      "--ignore-scripts",
      "--no-frozen-lockfile",
      "--config.auto-install-peers=false"
    ], { cwd: consumerRoot })
  })

const packAndValidate = (smokeRoot, packageManifest, parserRelease) =>
  Effect.gen(function*() {
    const tarball = join(smokeRoot, "quint-connect.tgz")
    yield* fileOperation(
      "Failed to write consumer workspace",
      () => writeFile(
        join(smokeRoot, "pnpm-workspace.yaml"),
        `minimumReleaseAgeExclude:\n  - '${parserRelease}'\n`
      )
    )
    yield* run("pnpm", ["pack", "--out", tarball], {
      env: { HUSKY: "0", npm_config_dry_run: "false" }
    })

    const packedManifest = yield* decodePackageContractManifestJson(
      yield* run("tar", ["-xOf", tarball, "package/package.json"])
    ).pipe(Effect.mapError((cause) => smokeError(`Invalid packed manifest: ${String(cause)}`)))
    const packedPaths = yield* decode(
      Schema.Array(Schema.NonEmptyString),
      (yield* run("tar", ["-tzf", tarball])).split("\n").filter(Boolean),
      "packed tar path listing"
    )
    const packedFiles = new Set(
      packedPaths.map((path) => path.replace(/^package\//, "").replace(/\/$/, ""))
    )
    const problems = yield* Effect.try({
      try: () => validatePackageContract(packedManifest, packedFiles),
      catch: (cause) => smokeError(`Failed to validate package contract: ${String(cause)}`)
    })
    yield* verify(problems.length === 0, problems.join("\n"))
    yield* verify(
      packedManifest.version === packageManifest.version,
      `Packed version ${String(packedManifest.version)} does not match ${packageManifest.version}`
    )
    return tarball
  })

const validateBaseConsumer = (smokeRoot, tarball, packageManifest, runtimeCommand) =>
  Effect.gen(function*() {
    yield* fileOperation("Failed to copy base consumer fixture", () => copyFile(
      join(repoRoot, "test/fixtures/packed-consumer.mjs"),
      join(smokeRoot, "packed-consumer.mjs")
    ))
    yield* fileOperation("Failed to copy counter fixture", () =>
      copyFile(join(repoRoot, "test/specs/counter.qnt"), join(smokeRoot, "counter.qnt")))

    yield* installConsumer(smokeRoot, {
      "@firfi/quint-connect": `file:${tarball}`,
      effect: packageManifest.dependencies.effect
    })

    const quintBin = join(repoRoot, "node_modules", ".bin", "quint")
    yield* fileOperation("Pinned Quint CLI is unavailable", () => access(quintBin))
    yield* run(runtimeCommand, [join(smokeRoot, "packed-consumer.mjs")], {
      cwd: smokeRoot,
      env: {
        PACKED_CONSUMER_QUINT_BIN: quintBin,
        PACKED_CONSUMER_SPEC: join(smokeRoot, "counter.qnt")
      }
    })

    const binResult = yield* spawnProcess(join(smokeRoot, "node_modules", ".bin", "intent"), [], {
      cwd: smokeRoot
    })
    yield* verify(binResult.status === 1, `intent bin exited with status ${String(binResult.status)}`)
    yield* verify(
      /@tanstack\/intent is not installed/u.test(binResult.stderr ?? ""),
      "intent bin did not report its missing optional dependency"
    )
  })

const validateZodConsumer = (smokeRoot, tarball, packageManifest, runtimeCommand) =>
  Effect.gen(function*() {
    yield* fileOperation("Failed to copy Zod consumer fixture", () => copyFile(
      join(repoRoot, "test/fixtures/packed-consumer-zod.mjs"),
      join(smokeRoot, "packed-consumer-zod.mjs")
    ))
    yield* installConsumer(smokeRoot, {
      "@firfi/quint-connect": `file:${tarball}`,
      effect: packageManifest.dependencies.effect,
      zod: packageManifest.devDependencies.zod
    })
    yield* run(runtimeCommand, [join(smokeRoot, "packed-consumer-zod.mjs")], { cwd: smokeRoot })
  })

const temporaryDirectory = Effect.acquireRelease(
  fileOperation(
    "Failed to create packed-consumer directory",
    () => mkdtemp(join(tmpdir(), "quint-connect-packed-consumer-"))
  ),
  (path) => fileOperation(
    "Failed to remove packed-consumer directory",
    () => rm(path, { recursive: true, force: true })
  ).pipe(Effect.orDie)
)

const program = Effect.scoped(Effect.gen(function*() {
  const manifestSource = yield* fileOperation(
    "Failed to read repository manifest",
    () => readFile(join(repoRoot, "package.json"), "utf8")
  )
  const packageManifest = yield* decode(RepositoryManifest, manifestSource, "repository manifest")
  const runtime = yield* decode(Runtime, process.env.PACKED_CONSUMER_RUNTIME ?? "node", "consumer runtime")
  const runtimeCommand = runtime === "node" ? process.execPath : "bun"
  const parserRelease = `@firfi/itf-trace-parser@${packageManifest.dependencies["@firfi/itf-trace-parser"]}`
  const smokeRoot = yield* temporaryDirectory
  const tarball = yield* packAndValidate(smokeRoot, packageManifest, parserRelease)
  yield* validateBaseConsumer(smokeRoot, tarball, packageManifest, runtimeCommand)
  yield* validateZodConsumer(smokeRoot, tarball, packageManifest, runtimeCommand)
  console.log(`Packed consumer smoke passed with ${runtime} for ${packageManifest.name}@${packageManifest.version}`)
}))

await Effect.runPromise(program)
