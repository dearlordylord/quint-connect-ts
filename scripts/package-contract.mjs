const requiredExports = {
  ".": { default: "./dist/index.js", types: "./dist/index.d.ts" },
  "./effect": { default: "./dist/effect.js", types: "./dist/effect.d.ts" },
  "./vitest": { default: "./dist/vitest.js", types: "./dist/vitest.d.ts" },
  "./vitest-simple": { default: "./dist/vitest-simple.js", types: "./dist/vitest-simple.d.ts" },
  "./zod": { default: "./dist/zod.js", types: "./dist/zod.d.ts" }
}

const packagePath = (target) => target.startsWith("./") ? target.slice(2) : target

export const validatePackageContract = (manifest, packedFiles) => {
  const problems = []

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
