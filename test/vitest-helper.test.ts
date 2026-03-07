import { Effect, Schema } from "effect"
import * as path from "node:path"
import { describe } from "vitest"

import type { Driver, Step } from "../src/driver/types.js"
import { pickFrom } from "../src/itf/picks.js"
import { ITFBigInt } from "../src/itf/schema.js"
import { decodeBigInt, pick } from "../src/simple.js"
import { quintIt, quintTest } from "../src/vitest.js"

type CounterState = { readonly count: bigint }

const CounterStateSchema = Schema.Struct({
  count: ITFBigInt
})

const specDir = path.resolve(import.meta.dirname, "specs")

const createSimpleCounterDriver = () => {
  let count = 0n
  return {
    step: (step: Step) => {
      switch (step.action) {
        case "Increment": {
          const amount = pick(step, "amount", decodeBigInt)
          if (amount !== undefined) {
            count = count + amount
          }
          break
        }
        case "init":
          break
        default:
          break
      }
    },
    getState: () => ({ count })
  }
}

const createEffectCounterDriver = (): Driver<CounterState> => {
  let count = 0n
  return {
    step: (step: Step) =>
      Effect.gen(function*() {
        switch (step.action) {
          case "Increment": {
            const amount = yield* pickFrom(step, "amount", ITFBigInt)
            if (amount !== undefined) {
              count = count + amount
            }
            break
          }
          case "init":
            break
          default:
            break
        }
      }),
    getState: () => Effect.succeed({ count })
  }
}

describe("Vitest helpers", () => {
  describe("quintTest (simple API)", () => {
    quintTest("replays counter traces via simple API", {
      spec: path.join(specDir, "counter.qnt"),
      nTraces: 3,
      maxSamples: 3,
      maxSteps: 5,
      seed: "1",
      createDriver: createSimpleCounterDriver,
      stateCheck: {
        compareState: (spec: CounterState, impl: CounterState) => spec.count === impl.count,
        deserializeState: (raw) => Schema.decodeUnknownSync(CounterStateSchema)(raw)
      }
    })
  })

  describe("quintIt (Effect API)", () => {
    quintIt("replays counter traces via Effect API", {
      spec: path.join(specDir, "counter.qnt"),
      nTraces: 3,
      maxSamples: 3,
      maxSteps: 5,
      seed: "1",
      driverFactory: {
        create: () => Effect.succeed(createEffectCounterDriver())
      },
      stateCheck: {
        compareState: (spec: CounterState, impl: CounterState) => spec.count === impl.count,
        deserializeState: (raw) => Schema.decodeUnknown(CounterStateSchema)(raw).pipe(Effect.orDie)
      }
    })
  })
})
