import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import { parsePackageContractManifest, validatePackageContract } from "./package-contract.mjs"

const packedFiles = new Set([
  "bin/intent.js",
  "dist/effect.d.ts",
  "dist/effect.js",
  "dist/index.d.ts",
  "dist/index.js",
  "dist/vitest-simple.d.ts",
  "dist/vitest-simple.js",
  "dist/vitest.d.ts",
  "dist/vitest.js",
  "dist/zod.d.ts",
  "dist/zod.js"
])

const currentManifest = parsePackageContractManifest(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
)

test("the repository manifest declares the supported package contract", () => {
  assert.deepEqual(validatePackageContract(currentManifest, packedFiles), [])
})

test("rejects an export whose runtime file is absent", () => {
  const files = new Set(packedFiles)
  files.delete("dist/effect.js")

  assert.deepEqual(validatePackageContract(currentManifest, files), [
    "Export ./effect default target ./dist/effect.js is missing from the package"
  ])
})

test("rejects an unsupported Node floor or Effect generation", () => {
  assert.deepEqual(validatePackageContract({
    ...currentManifest,
    engines: { node: ">=20" },
    dependencies: { ...currentManifest.dependencies, effect: "^4.0.0" }
  }, packedFiles), [
    "Node engine must be >=22, found >=20",
    "Runtime and peer dependencies must target Effect 3"
  ])
})

test("rejects a broken CLI bin path", () => {
  assert.deepEqual(validatePackageContract({
    ...currentManifest,
    bin: { intent: "bin/missing.js" }
  }, packedFiles), [
    "Bin intent target must be bin/intent.js, found bin/missing.js"
  ])
})

test("rejects Zod as a required peer", () => {
  assert.deepEqual(validatePackageContract({
    ...currentManifest,
    peerDependenciesMeta: {
      ...currentManifest.peerDependenciesMeta,
      zod: { optional: false }
    }
  }, packedFiles), [
    "Zod must remain an optional peer dependency"
  ])
})
