import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { validatePackageContract } from "./package-contract.mjs"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packageManifest = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"))
const runtime = process.env.PACKED_CONSUMER_RUNTIME ?? "node"
const runtimeCommand = runtime === "node" ? process.execPath : runtime === "bun" ? "bun" : undefined
const parserRelease = `@firfi/itf-trace-parser@${packageManifest.dependencies["@firfi/itf-trace-parser"]}`

if (runtimeCommand === undefined) {
  throw new Error(`Unsupported packed-consumer runtime: ${runtime}`)
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...options.env }
  })
  if (result.error !== undefined) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} exited with status ${String(result.status)}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"))
  }
  return result.stdout
}

const installConsumer = async (consumerRoot, dependencies) => {
  await writeFile(join(consumerRoot, "package.json"), JSON.stringify({
    name: "quint-connect-packed-smoke",
    private: true,
    type: "module",
    dependencies
  }, null, 2))
  run("pnpm", [
    "install",
    "--prefer-offline",
    "--ignore-scripts",
    "--no-frozen-lockfile",
    "--config.auto-install-peers=false"
  ], { cwd: consumerRoot })
}

let smokeRoot
let failure
try {
  smokeRoot = await mkdtemp(join(tmpdir(), "quint-connect-packed-consumer-"))
  const tarball = join(smokeRoot, "quint-connect.tgz")

  await writeFile(
    join(smokeRoot, "pnpm-workspace.yaml"),
    `minimumReleaseAgeExclude:\n  - '${parserRelease}'\n`
  )

  run("pnpm", ["pack", "--out", tarball], {
    env: { HUSKY: "0", npm_config_dry_run: "false" }
  })

  const packedManifest = JSON.parse(run("tar", ["-xOf", tarball, "package/package.json"]))
  const packedFiles = new Set(
    run("tar", ["-tzf", tarball])
      .split("\n")
      .filter(Boolean)
      .map((path) => path.replace(/^package\//, "").replace(/\/$/, ""))
  )
  assert.deepEqual(validatePackageContract(packedManifest, packedFiles), [])
  assert.equal(packedManifest.version, packageManifest.version)

  await copyFile(
    join(repoRoot, "test/fixtures/packed-consumer.mjs"),
    join(smokeRoot, "packed-consumer.mjs")
  )
  await copyFile(join(repoRoot, "test/specs/counter.qnt"), join(smokeRoot, "counter.qnt"))

  const packageDependency = `file:${tarball}`
  await installConsumer(smokeRoot, {
    "@firfi/quint-connect": packageDependency,
    effect: packageManifest.dependencies.effect
  })

  const quintBin = join(repoRoot, "node_modules", ".bin", "quint")
  await access(quintBin)
  run(runtimeCommand, [join(smokeRoot, "packed-consumer.mjs")], {
    cwd: smokeRoot,
    env: {
      PACKED_CONSUMER_QUINT_BIN: quintBin,
      PACKED_CONSUMER_SPEC: join(smokeRoot, "counter.qnt")
    }
  })

  const binResult = spawnSync(join(smokeRoot, "node_modules", ".bin", "intent"), [], {
    cwd: smokeRoot,
    encoding: "utf8"
  })
  assert.equal(binResult.status, 1)
  assert.match(binResult.stderr, /@tanstack\/intent is not installed/)

  await copyFile(
    join(repoRoot, "test/fixtures/packed-consumer-zod.mjs"),
    join(smokeRoot, "packed-consumer-zod.mjs")
  )
  await installConsumer(smokeRoot, {
    "@firfi/quint-connect": packageDependency,
    effect: packageManifest.dependencies.effect,
    zod: packageManifest.devDependencies.zod
  })
  run(runtimeCommand, [join(smokeRoot, "packed-consumer-zod.mjs")], { cwd: smokeRoot })
} catch (error) {
  failure = error
} finally {
  if (smokeRoot !== undefined) {
    await rm(smokeRoot, { recursive: true, force: true })
  }
}

if (smokeRoot !== undefined) {
  await assert.rejects(access(smokeRoot), { code: "ENOENT" })
}
if (failure !== undefined) {
  throw failure
}

console.log(`Packed consumer smoke passed with ${runtime} for ${packageManifest.name}@${packageManifest.version}`)
