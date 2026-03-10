import { Effect, Schema } from "effect"
import * as path from "node:path"
import { describe } from "vitest"
import { z } from "zod"

import { ITFBigInt as EffectITFBigInt } from "@firfi/itf-trace-parser/effect"
import { ITFBigInt as ZodITFBigInt } from "@firfi/itf-trace-parser/zod"

import { defineDriver as defineEffectDriver, stateCheck as effectStateCheck } from "../src/effect.js"
import { defineDriver, stateCheck } from "../src/simple.js"
import { quintIt, quintTest } from "../src/vitest.js"

const CounterState = z.object({ count: z.bigint() })
const CounterStateSchema = Schema.Struct({ count: EffectITFBigInt })

const specDir = path.resolve(import.meta.dirname, "specs")

describe("Vitest helpers", () => {
  describe("quintTest (simple API with Zod)", () => {
    quintTest("replays counter traces via simple API with Zod", {
      spec: path.join(specDir, "counter.qnt"),
      nTraces: 3,
      maxSamples: 3,
      maxSteps: 5,
      seed: "1",
      driver: defineDriver({ Increment: { amount: ZodITFBigInt } }, () => {
        let count = 0n
        return {
          Increment: ({ amount }) => {
            count += amount
          },
          getState: () => ({ count })
        }
      }),
      stateCheck: stateCheck(
        (raw) => CounterState.parse(raw),
        (spec, impl) => spec.count === impl.count
      )
    })
  })

  describe("quintIt (Effect API with defineDriver)", () => {
    quintIt("replays counter traces via Effect API", {
      spec: path.join(specDir, "counter.qnt"),
      nTraces: 3,
      maxSamples: 3,
      maxSteps: 5,
      seed: "1",
      driverFactory: defineEffectDriver(
        { Increment: { amount: EffectITFBigInt } },
        () => {
          let count = 0n
          return {
            Increment: ({ amount }) =>
              Effect.sync(() => {
                count += amount
              }),
            getState: () => Effect.succeed({ count })
          }
        }
      ),
      stateCheck: effectStateCheck(
        (raw) => Schema.decodeUnknown(CounterStateSchema)(raw).pipe(Effect.orDie),
        (spec, impl) => spec.count === impl.count
      )
    })
  })
})
