import assert from "node:assert/strict"

const effect = await import("effect")
const environment = effect.Schema.decodeUnknownSync(effect.Schema.Struct({
  PACKED_CONSUMER_SPEC: effect.Schema.String,
  PACKED_CONSUMER_QUINT_BIN: effect.Schema.String
}))(process.env)

const [simpleApi, zodApi] = await Promise.all([
  import("@firfi/quint-connect"),
  import("@firfi/quint-connect/zod")
])

assert.equal(zodApi.ITFBigInt.parse(42n), 42n)

const expectedAmount = 900719925474099312345678901234567890n
const amounts = []
const result = await simpleApi.run({
  spec: environment.PACKED_CONSUMER_SPEC,
  nTraces: 1,
  maxSamples: 1,
  maxSteps: 1,
  seed: "2",
  quintBin: environment.PACKED_CONSUMER_QUINT_BIN,
  driver: simpleApi.defineDriver(
    { init: {}, AddHuge: { amount: zodApi.ITFBigInt } },
    () => ({
      init: () => {},
      AddHuge: ({ amount }) => {
        amounts.push(amount)
      }
    })
  )
})

assert.deepEqual(result, { tracesReplayed: 1, seed: "2" })
assert.ok(amounts.length > 0)
assert.ok(amounts.every((amount) => amount === expectedAmount))
