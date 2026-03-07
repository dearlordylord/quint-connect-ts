import { NodeContext } from "@effect/platform-node"
import { describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as path from "node:path"
import { expect } from "vitest"
import type { Driver, Step } from "../src/driver/types.js"
import { ItfBigInt } from "../src/itf/schema.js"
import { quintRun } from "../src/runner/runner.js"

// Quint nondet picks use Option variant encoding:
// Some(x) = { tag: "Some", value: x }
// None    = { tag: "None", value: { "#tup": [] } }
const extractNondetBigInt = (picks: ReadonlyMap<string, unknown>, key: string): bigint | undefined => {
  const raw = picks.get(key)
  if (typeof raw !== "object" || raw === null) return undefined
  const variant = raw as { readonly tag: string; readonly value: unknown }
  if (variant.tag === "None") return undefined
  if (variant.tag !== "Some") return undefined
  const val = variant.value
  if (typeof val !== "object" || val === null) return undefined
  const bigintObj = val as { readonly "#bigint"?: string }
  if (typeof bigintObj["#bigint"] !== "string") return undefined
  return BigInt(bigintObj["#bigint"])
}

type CounterState = { readonly count: bigint }

const CounterStateSchema = Schema.Struct({
  count: ItfBigInt
})

const specDir = path.resolve(import.meta.dirname, "specs")

const createCounterDriver = (): Driver<CounterState> => {
  let count = 0n
  return {
    step: (step: Step) =>
      Effect.sync(() => {
        switch (step.action) {
          case "Increment": {
            const amount = extractNondetBigInt(step.nondetPicks, "amount")
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
        compareState: (spec: CounterState, impl: CounterState) => spec.count === impl.count,
        deserializeState: (raw) => Schema.decodeUnknown(CounterStateSchema)(raw).pipe(Effect.orDie)
      })

      expect(result.tracesReplayed).toBeGreaterThan(0)
    }).pipe(
      Effect.provide(NodeContext.layer),
      Effect.scoped
    ), { timeout: 30000 })
})
