import assert from "node:assert/strict"

const zodApi = await import("@firfi/quint-connect/zod")

assert.equal(zodApi.ITFBigInt.parse(42n), 42n)
