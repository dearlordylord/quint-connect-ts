/**
 * Effect API example: Effect Schema + vitest
 *
 * Use this when you need Effect's typed error channels, services,
 * or resource management in your driver.
 */
import { it as effectIt } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as path from "node:path"
import { describe } from "vitest"

import { defineDriver, ITFBigInt, stateCheck } from "../../src/effect.js"
import { quintIt } from "../../src/vitest.js"

// 1. Define state schema (ITFBigInt handles {"#bigint":"N"} → bigint)
const CounterState = Schema.Struct({ count: ITFBigInt })

// 2. Define driver with Effect Schema per-field picks
const counterDriver = defineDriver(
  { init: {}, Increment: { amount: ITFBigInt } },
  () => {
    let count = 0n
    return {
      init: () => Effect.void,
      Increment: ({ amount }) =>
        Effect.sync(() => {
          count += amount
        }),
      getState: () => Effect.succeed({ count })
    }
  }
)

// 3. Use quintIt for Effect-based tests
describe("Counter MBT (Effect)", () => {
  quintIt(effectIt.effect, "replays Quint traces against TS implementation", {
    spec: path.join(import.meta.dirname, "specs", "counter.qnt"),
    driverFactory: counterDriver,
    stateCheck: stateCheck(
      (raw) => Schema.decodeUnknown(CounterState)(raw).pipe(Effect.orDie),
      (spec, impl) => spec.count === impl.count
    )
  })
})
