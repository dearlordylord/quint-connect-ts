import assert from "node:assert/strict"

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

let count = 0n
const result = await effect.Effect.runPromise(effectApi.quintRun({
  spec: process.env.PACKED_CONSUMER_SPEC,
  nTraces: 1,
  maxSamples: 2,
  maxSteps: 3,
  seed: "1",
  quintBin: process.env.PACKED_CONSUMER_QUINT_BIN,
  driverFactory: effectApi.defineDriver(
    { init: {}, Increment: { amount: effectApi.ITFBigInt } },
    () => ({
      init: () => effect.Effect.void,
      Increment: ({ amount }) => effect.Effect.sync(() => {
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
