import { Effect } from "effect"
import { expect, it } from "vitest"

import { quintRun } from "../src/effect.js"
import { run } from "../src/index.js"
import { quintTest } from "../src/vitest-simple.js"
import { quintIt } from "../src/vitest.js"

const simpleDriver = () => ({ actions: {} })
const effectDriverFactory = { create: () => Effect.succeed({ actions: {} }) }

const assertPublicGenerationCompatibility = (): void => {
  void run({ spec: "counter.qnt", driver: simpleDriver })
  void run({
    spec: "counter.qnt",
    generation: { mode: "test", test: "scenario" },
    driver: simpleDriver
  })

  void quintRun({ spec: "counter.qnt", driverFactory: effectDriverFactory })
  void quintRun({
    spec: "counter.qnt",
    generation: { mode: "test", test: "scenario" },
    driverFactory: effectDriverFactory
  })

  quintIt(() => undefined, "run mode", { spec: "counter.qnt", driverFactory: effectDriverFactory })
  quintIt(() => undefined, "test mode", {
    spec: "counter.qnt",
    generation: { mode: "test", test: "scenario" },
    driverFactory: effectDriverFactory
  })

  quintTest(() => undefined, "run mode", { spec: "counter.qnt", driver: simpleDriver })
  quintTest(() => undefined, "test mode", {
    spec: "counter.qnt",
    generation: { mode: "test", test: "scenario" },
    driver: simpleDriver
  })
}

it("keeps run mode source-compatible and exposes test mode on every public entrypoint", () => {
  expect(assertPublicGenerationCompatibility).toBeTypeOf("function")
})
