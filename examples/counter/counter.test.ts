/**
 * Simple API example: Zod schemas + vitest
 *
 * This is the recommended way to integrate quint-connect into your test suite.
 * Uses Zod for pick/state schemas and the `quintTest` vitest helper.
 */
import * as path from "node:path"
import { describe } from "vitest"
import { z } from "zod"

import { ITFBigInt } from "@firfi/itf-trace-parser/zod"

import { defineDriver, stateCheck } from "../../src/simple.js"
import { quintTest } from "../../src/vitest.js"

// 1. Define state schema (raw ITF values are pre-transformed to native types)
const CounterState = z.object({ count: z.bigint() })

// 2. Define action schemas and a factory that returns handlers + state accessor
const counterDriver = defineDriver(
  { Increment: { amount: ITFBigInt } },
  () => {
    let count = 0n
    return {
      Increment: ({ amount }) => {
        count += amount
      },
      getState: () => ({ count })
    }
  }
)

// 3. Use quintTest to wire it all up
describe("Counter MBT", () => {
  quintTest("replays Quint traces against TS implementation", {
    spec: path.join(import.meta.dirname, "specs", "counter.qnt"),
    driver: counterDriver,
    stateCheck: stateCheck(
      (raw) => CounterState.parse(raw),
      (spec, impl) => spec.count === impl.count
    )
  })
})
