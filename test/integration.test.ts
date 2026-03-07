import { NodeContext } from "@effect/platform-node"
import { describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as path from "node:path"
import { expect } from "vitest"
import type { Driver, Step } from "../src/driver/types.js"
import { pickFrom } from "../src/itf/picks.js"
import { ITFBigInt } from "../src/itf/schema.js"
import { quintRun } from "../src/runner/runner.js"

type CounterState = { readonly count: bigint }

const CounterStateSchema = Schema.Struct({
  count: ITFBigInt
})

const specDir = path.resolve(import.meta.dirname, "specs")

const createCounterDriver = (): Driver<CounterState> => {
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

const createStatelessCounterDriver = (): Driver<unknown> => ({
  step: (step: Step) =>
    Effect.gen(function*() {
      switch (step.action) {
        case "Increment": {
          yield* pickFrom(step, "amount", ITFBigInt)
          break
        }
        case "init":
          break
        default:
          break
      }
    })
})

describe("Integration: counter spec", () => {
  it.effect("replays traces from quint run against a TS driver", () =>
    Effect.gen(function*() {
      const result = yield* quintRun({
        spec: path.join(specDir, "counter.qnt"),
        nTraces: 3,
        maxSamples: 3,
        maxSteps: 5,
        seed: "1",
        driverFactory: {
          create: () => Effect.succeed(createCounterDriver())
        },
        stateCheck: {
          compareState: (spec: CounterState, impl: CounterState) => spec.count === impl.count,
          deserializeState: (raw) => Schema.decodeUnknown(CounterStateSchema)(raw).pipe(Effect.orDie)
        }
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)
      expect(result.seed).toBe("1")
    }).pipe(
      Effect.provide(NodeContext.layer),
      Effect.scoped
    ), { timeout: 30000 })

  it.effect("replays traces without stateCheck and without getState", () =>
    Effect.gen(function*() {
      const result = yield* quintRun({
        spec: path.join(specDir, "counter.qnt"),
        nTraces: 3,
        maxSamples: 3,
        maxSteps: 5,
        seed: "1",
        driverFactory: {
          create: () => Effect.succeed(createStatelessCounterDriver())
        }
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)
      expect(result.seed).toBe("1")
    }).pipe(
      Effect.provide(NodeContext.layer),
      Effect.scoped
    ), { timeout: 30000 })
})
