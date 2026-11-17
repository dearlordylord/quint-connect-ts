import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const effect = await import("effect")
const environment = effect.Schema.decodeUnknownSync(effect.Schema.Struct({
  PACKED_CONSUMER_QUINT_BIN: effect.Schema.String,
  PACKED_CONSUMER_SPEC: effect.Schema.String,
  PACKED_CONSUMER_PACKAGE_VERSION: effect.Schema.String,
  PACKED_CONSUMER_PARSER_VERSION: effect.Schema.String
}))(process.env)

await assert.rejects(
  import("zod"),
  (input) => {
    const ErrorLike = effect.Schema.declare(
      (value) => typeof value === "object"
        && value !== null
        && "message" in value
        && typeof value.message === "string"
    )
    const error = effect.Schema.decodeUnknownOption(ErrorLike)(input)
    return effect.Option.isSome(error) && effect.Schema.is(
      effect.Schema.String.pipe(effect.Schema.pattern(/(?:package|module) ['"]?zod/iu))
    )(error.value.message)
  },
  "The Effect-only consumer unexpectedly resolved Zod"
)

const [main, effectApi, vitestApi, vitestSimpleApi] = await Promise.all([
  import("@firfi/quint-connect"),
  import("@firfi/quint-connect/effect"),
  import("@firfi/quint-connect/vitest"),
  import("@firfi/quint-connect/vitest-simple")
])

assert.equal(typeof main.run, "function")
assert.equal(typeof effectApi.quintRun, "function")
assert.equal(typeof vitestApi.quintIt, "function")
assert.equal(typeof vitestSimpleApi.quintTest, "function")

const installedManifest = effect.Schema.decodeUnknownSync(effect.Schema.parseJson(effect.Schema.Struct({
  version: effect.Schema.String,
  dependencies: effect.Schema.Struct({ "@firfi/itf-trace-parser": effect.Schema.String })
})))(await readFile(new URL("../package.json", import.meta.resolve("@firfi/quint-connect")), "utf8"))
assert.equal(installedManifest.version, environment.PACKED_CONSUMER_PACKAGE_VERSION)
assert.equal(installedManifest.dependencies["@firfi/itf-trace-parser"], environment.PACKED_CONSUMER_PARSER_VERSION)

const expectedAmount = 900719925474099312345678901234567890n
const amounts = []
let count = 0n
const result = await effect.Effect.runPromise(effectApi.quintRun({
  spec: environment.PACKED_CONSUMER_SPEC,
  nTraces: 1,
  maxSamples: 2,
  maxSteps: 3,
  seed: "1",
  quintBin: environment.PACKED_CONSUMER_QUINT_BIN,
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
    (raw) => effect.Schema.decodeUnknown(
      effect.Schema.Struct({ count: effectApi.ITFBigInt })
    )(raw).pipe(effect.Effect.orDie),
    (specState, implementationState) => specState.count === implementationState.count
  )
}))

assert.equal(result.seed, "1")
assert.ok(result.tracesReplayed > 0)

assert.ok(amounts.length > 0)
assert.ok(amounts.every((amount) => amount === expectedAmount))
