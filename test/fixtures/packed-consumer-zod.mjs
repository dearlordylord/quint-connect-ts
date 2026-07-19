import assert from "node:assert/strict"

const [simpleApi, zodApi] = await Promise.all([
  import("@firfi/quint-connect"),
  import("@firfi/quint-connect/zod")
])

assert.equal(zodApi.ITFBigInt.parse(42n), 42n)

const expectedAmount = 900719925474099312345678901234567890n
const amounts = []
const result = await simpleApi.run({
  spec: process.env.PACKED_CONSUMER_SPEC,
  nTraces: 1,
  maxSamples: 1,
  maxSteps: 1,
  seed: "2",
  quintBin: process.env.PACKED_CONSUMER_QUINT_BIN,
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
