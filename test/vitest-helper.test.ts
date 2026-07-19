import { it as effectIt } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as path from "node:path"
import { describe, expectTypeOf, test } from "vitest"
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
    quintTest(test, "replays counter traces via simple API with Zod", {
      spec: path.join(specDir, "counter.qnt"),
      nTraces: 3,
      maxSamples: 3,
      maxSteps: 5,
      seed: "1",
      driver: defineDriver({ init: {}, Increment: { amount: ZodITFBigInt } }, () => {
        let count = 0n
        return {
          init: () => {},
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
    quintIt(effectIt.effect, "replays counter traces via Effect API", {
      spec: path.join(specDir, "counter.qnt"),
      nTraces: 3,
      maxSamples: 3,
      maxSteps: 5,
      seed: "1",
      driverFactory: defineEffectDriver(
        { init: {}, Increment: { amount: EffectITFBigInt } },
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
      ),
      stateCheck: effectStateCheck(
        (raw) => Schema.decodeUnknown(CounterStateSchema)(raw).pipe(Effect.orDie),
        (spec, impl) => spec.count === impl.count
      )
    })
  })

  describe("driver pick type inference", () => {
    test("infers simple and Effect handler picks from schemas", () => {
      const simpleDriver = defineDriver({ Increment: { amount: ZodITFBigInt } }, () => ({
        Increment: ({ amount }) => {
          expectTypeOf(amount).toEqualTypeOf<bigint>()
          // @ts-expect-error amount is inferred as bigint, not string.
          const invalid: string = amount
          void invalid
        }
      }))

      const effectDriver = defineEffectDriver(
        { Increment: { amount: EffectITFBigInt } },
        () => ({
          Increment: ({ amount }) => {
            expectTypeOf(amount).toEqualTypeOf<bigint>()
            // @ts-expect-error amount is inferred as bigint, not string.
            const invalid: string = amount
            void invalid
            return Effect.void
          }
        })
      )

      expectTypeOf(simpleDriver).toBeFunction()
      expectTypeOf(effectDriver.create).toBeFunction()
    })
  })
})
