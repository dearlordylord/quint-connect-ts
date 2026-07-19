import { Schema } from "effect"

const requiredExports = {
  ".": { default: "./dist/index.js", types: "./dist/index.d.ts" },
  "./effect": { default: "./dist/effect.js", types: "./dist/effect.d.ts" },
  "./vitest": { default: "./dist/vitest.js", types: "./dist/vitest.d.ts" },
  "./vitest-simple": { default: "./dist/vitest-simple.js", types: "./dist/vitest-simple.d.ts" },
  "./zod": { default: "./dist/zod.js", types: "./dist/zod.d.ts" }
}

const packagePath = (target) => target.startsWith("./") ? target.slice(2) : target

const ExportTargets = Schema.Struct({
  default: Schema.optional(Schema.String),
  types: Schema.optional(Schema.String)
})

const PackageContractManifest = Schema.Struct({
  version: Schema.optional(Schema.String),
  engines: Schema.optional(Schema.Struct({ node: Schema.optional(Schema.String) })),
  exports: Schema.optional(Schema.Record({ key: Schema.String, value: ExportTargets })),
  bin: Schema.optional(Schema.Struct({ intent: Schema.optional(Schema.String) })),
  dependencies: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  peerDependencies: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  peerDependenciesMeta: Schema.optional(Schema.Record({
    key: Schema.String,
    value: Schema.Struct({ optional: Schema.optional(Schema.Boolean) })
  })),
  devDependencies: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String }))
})

const decodeManifest = Schema.decodeUnknownSync(PackageContractManifest)

export const decodePackageContractManifestJson = Schema.decodeUnknown(
  Schema.parseJson(PackageContractManifest)
)

export const parsePackageContractManifest = Schema.decodeUnknownSync(
  Schema.parseJson(PackageContractManifest)
)

export const validatePackageContract = (input, packedFiles) => {
  const manifest = decodeManifest(input)
  const problems = []

  if (manifest.engines?.node !== ">=22") {
    problems.push(`Node engine must be >=22, found ${String(manifest.engines?.node)}`)
  }
  if (
    typeof manifest.dependencies?.effect !== "string"
    || !manifest.dependencies.effect.startsWith("^3.")
    || manifest.peerDependencies?.effect !== "^3.0.0"
  ) {
    problems.push("Runtime and peer dependencies must target Effect 3")
  }

  for (const [entrypoint, expectedTargets] of Object.entries(requiredExports)) {
    const actualTargets = manifest.exports?.[entrypoint]
    if (actualTargets === undefined) {
      problems.push(`Missing required export ${entrypoint}`)
      continue
    }

    for (const [condition, expectedTarget] of Object.entries(expectedTargets)) {
      const actualTarget = actualTargets[condition]
      if (actualTarget !== expectedTarget) {
        problems.push(
          `Export ${entrypoint} ${condition} target must be ${expectedTarget}, found ${String(actualTarget)}`
        )
        continue
      }
      if (!packedFiles.has(packagePath(actualTarget))) {
        problems.push(`Export ${entrypoint} ${condition} target ${actualTarget} is missing from the package`)
      }
    }
  }

  const intentBin = manifest.bin?.intent
  if (intentBin !== "bin/intent.js") {
    problems.push(`Bin intent target must be bin/intent.js, found ${String(intentBin)}`)
  } else if (!packedFiles.has(intentBin)) {
    problems.push(`Bin intent target ${intentBin} is missing from the package`)
  }

  if (
    typeof manifest.peerDependencies?.zod !== "string"
    || manifest.peerDependenciesMeta?.zod?.optional !== true
    || manifest.dependencies?.zod !== undefined
  ) {
    problems.push("Zod must remain an optional peer dependency")
  }

  return problems
}
