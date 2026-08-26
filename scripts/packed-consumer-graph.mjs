const dependencyEntries = (tree, entries = []) => {
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, dependency] of Object.entries(tree[section] ?? {})) {
      if (typeof dependency !== "object" || dependency === null) continue
      entries.push({
        name,
        path: dependency.path,
        overridden: dependency.overridden,
        version: dependency.version
      })
      dependencyEntries(dependency, entries)
    }
  }
  return entries
}

const directDependency = (node, name) => node?.dependencies?.[name]

const hasNonEmptyPath = (path) => typeof path === "string" && path.trim().length > 0

const requirePath = (problems, label, path) => {
  if (hasNonEmptyPath(path)) return true
  problems.push(`${label} path is missing or invalid`)
  return false
}

export const validatePackedConsumerGraph = (dependencyTree, packedManifest) => {
  const problems = []
  const packedName = packedManifest.name
  const packedVersion = packedManifest.version
  const parserName = "@firfi/itf-trace-parser"
  const expectedParserVersion = packedManifest.dependencies?.[parserName]
  const expectedEffectVersion = packedManifest.dependencies?.effect
  const packedNode = directDependency(dependencyTree, packedName)

  if (packedNode === undefined) {
    return [`packed consumer does not contain direct dependency ${packedName}`]
  }
  if (packedNode.version !== packedVersion) {
    problems.push(`packed consumer resolved ${packedName}@${String(packedNode.version)} instead of ${packedVersion}`)
  }

  const packedEffect = directDependency(packedNode, "effect")
  let packedEffectPathValid = false
  if (packedEffect === undefined) {
    problems.push("packed package does not expose its direct Effect dependency in the installed graph")
  } else {
    packedEffectPathValid = requirePath(problems, "packed package direct Effect runtime", packedEffect.path)
    if (packedEffect.version !== expectedEffectVersion) {
      problems.push(`packed package resolved Effect ${String(packedEffect.version)} instead of ${expectedEffectVersion}`)
    }
  }

  const packedParser = directDependency(packedNode, parserName)
  if (packedParser === undefined) {
    problems.push("packed package does not expose its direct parser dependency in the installed graph")
  } else {
    if (packedParser.version !== expectedParserVersion) {
      problems.push(`packed package resolved parser ${String(packedParser.version)} instead of ${expectedParserVersion}`)
    }
    const parserEffect = directDependency(packedParser, "effect")
    let parserEffectPathValid = false
    if (parserEffect === undefined) {
      problems.push("published parser peer is absent from the packed dependency graph")
    } else {
      parserEffectPathValid = requirePath(problems, "published parser peer", parserEffect.path)
      if (parserEffect.version !== expectedEffectVersion) {
        problems.push(`published parser peer resolved Effect ${String(parserEffect.version)} instead of ${expectedEffectVersion}`)
      }
      if (packedEffectPathValid && parserEffectPathValid && parserEffect.path !== packedEffect.path) {
        problems.push("published parser peer does not resolve to the packed package's direct Effect runtime")
      }
    }
  }

  const entries = dependencyEntries(packedNode)
  if (entries.some((entry) => entry.overridden === true)) {
    problems.push("packed dependency graph contains an override")
  }

  const effectEntries = entries.filter(({ name }) => name === "effect")
  const effectVersions = new Set(effectEntries.map(({ version }) => version))
  const effectPaths = new Set()
  const effectPathsValid = effectEntries.every((entry) => {
    if (!requirePath(problems, "Effect dependency node", entry.path)) return false
    effectPaths.add(entry.path)
    return true
  })
  if (effectVersions.size !== 1 || !effectVersions.has(expectedEffectVersion)) {
    problems.push("packed package dependency graph resolved more than the exact Effect version from its manifest")
  }
  if (effectPathsValid && effectPaths.size !== 1) {
    problems.push("packed package dependency graph resolved more than one Effect runtime path")
  }

  return problems
}
