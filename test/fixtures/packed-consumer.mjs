import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

await assert.rejects(
  import("zod"),
  (error) => error?.code === "ERR_MODULE_NOT_FOUND",
  "The Effect-only consumer unexpectedly resolved Zod"
)

const [main, effectApi, vitestApi, vitestSimpleApi, effect] = await Promise.all([
  import("@firfi/quint-connect"),
  import("@firfi/quint-connect/effect"),
  import("@firfi/quint-connect/vitest"),
  import("@firfi/quint-connect/vitest-simple"),
  import("effect")
])

assert.equal(typeof main.run, "function")
assert.equal(typeof effectApi.quintRun, "function")
assert.equal(typeof vitestApi.quintIt, "function")
assert.equal(typeof vitestSimpleApi.quintTest, "function")

const installedManifest = JSON.parse(await readFile(
  new URL("../package.json", import.meta.resolve("@firfi/quint-connect")),
  "utf8"
))
assert.equal(installedManifest.version, process.env.PACKED_CONSUMER_PACKAGE_VERSION)
assert.equal(
  installedManifest.dependencies["@firfi/itf-trace-parser"],
  process.env.PACKED_CONSUMER_PARSER_VERSION
)

const expectedAmount = 900719925474099312345678901234567890n
let count = 0n
const amounts = []
const result = await effect.Effect.runPromise(effectApi.quintRun({
  spec: process.env.PACKED_CONSUMER_SPEC,
  nTraces: 1,
  maxSamples: 2,
  maxSteps: 3,
  seed: "1",
  quintBin: process.env.PACKED_CONSUMER_QUINT_BIN,
  driverFactory: effectApi.defineDriver(
    { init: {}, AddHuge: { amount: effectApi.ITFBigInt } },
    () => ({
      init: () => effect.Effect.void,
      AddHuge: ({ amount }) => effect.Effect.sync(() => {
        amounts.push(amount)
        count += amount
      }),
      getState: () => effect.Effect.succeed({ count })
    })
  ),
  stateCheck: effectApi.stateCheck(
    (raw) => effect.Schema.decodeUnknownEffect(
      effect.Schema.Struct({ count: effectApi.ITFBigInt })
    )(raw).pipe(effect.Effect.orDie),
    (specState, implementationState) => specState.count === implementationState.count
  )
}))

assert.equal(result.seed, "1")
assert.ok(result.tracesReplayed > 0)
assert.ok(amounts.length > 0)
assert.ok(amounts.every((amount) => amount === expectedAmount))
