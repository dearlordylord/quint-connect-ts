import assert from "node:assert/strict"
import test from "node:test"

import { validatePackedConsumerGraph } from "./packed-consumer-graph.mjs"

const packedManifest = {
  name: "@firfi/quint-connect",
  version: "2.0.2-effect4.1",
  dependencies: {
    "@firfi/itf-trace-parser": "0.2.0-effect4.1",
    effect: "4.0.0-rc.112"
  }
}

const effect = {
  path: "/consumer/node_modules/.pnpm/effect@4.0.0-rc.112/node_modules/effect",
  version: "4.0.0-rc.112"
}

const parser = {
  dependencies: { effect },
  path: "/consumer/node_modules/.pnpm/@firfi+itf-trace-parser@0.2.0-effect4.1_effect@4.0.0-rc.112/node_modules/@firfi/itf-trace-parser",
  version: "0.2.0-effect4.1"
}

const validTree = {
  dependencies: {
    "@firfi/quint-connect": {
      dependencies: { "@firfi/itf-trace-parser": parser, effect },
      version: "2.0.2-effect4.1"
    },
    unrelated: {
      dependencies: { effect },
      version: "1.0.0"
    }
  }
}

test("accepts the packed package's direct dependency graph", () => {
  assert.deepEqual(validatePackedConsumerGraph(validTree, packedManifest), [])
})

test("does not accept an unrelated node that happens to contain Effect", () => {
  const unrelatedTree = {
    dependencies: {
      unrelated: validTree.dependencies.unrelated
    }
  }

  assert.deepEqual(validatePackedConsumerGraph(unrelatedTree, packedManifest), [
    "packed consumer does not contain direct dependency @firfi/quint-connect"
  ])
})

test("rejects a parser peer that resolves to a different Effect runtime", () => {
  const mismatchedParser = {
    ...parser,
    dependencies: {
      effect: {
        ...effect,
        path: "/consumer/node_modules/.pnpm/effect@4.0.0-rc.111/node_modules/effect",
        version: "4.0.0-rc.111"
      }
    }
  }
  const mismatchedTree = {
    dependencies: {
      "@firfi/quint-connect": {
        ...validTree.dependencies["@firfi/quint-connect"],
        dependencies: {
          "@firfi/itf-trace-parser": mismatchedParser,
          effect
        }
      }
    }
  }

  const problems = validatePackedConsumerGraph(mismatchedTree, packedManifest)
  assert.ok(problems.some((problem) => problem.includes("published parser peer resolved Effect")))
  assert.ok(problems.some((problem) => problem.includes("does not resolve to the packed package's direct Effect runtime")))
})

test("rejects missing Effect and parser peer paths before runtime identity checks", () => {
  const missingPathEffect = { ...effect, path: undefined }
  const missingPathParser = {
    ...parser,
    dependencies: {
      effect: { ...effect, path: undefined }
    }
  }
  const missingPathTree = {
    dependencies: {
      "@firfi/quint-connect": {
        ...validTree.dependencies["@firfi/quint-connect"],
        dependencies: {
          "@firfi/itf-trace-parser": missingPathParser,
          effect: missingPathEffect
        }
      }
    }
  }

  const problems = validatePackedConsumerGraph(missingPathTree, packedManifest)
  assert.ok(problems.some((problem) => problem.includes("packed package direct Effect runtime path is missing or invalid")))
  assert.ok(problems.some((problem) => problem.includes("published parser peer path is missing or invalid")))
  assert.ok(problems.some((problem) => problem.includes("Effect dependency node path is missing or invalid")))
})
