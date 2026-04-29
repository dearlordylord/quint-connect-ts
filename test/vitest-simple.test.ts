import * as path from "node:path"
import { describe, test } from "vitest"
import { z } from "zod"

import { ITFBigInt as ZodITFBigInt } from "@firfi/itf-trace-parser/zod"

import { defineDriver, stateCheck } from "../src/simple.js"
import { quintTest } from "../src/vitest-simple.js"

const CounterState = z.object({ count: z.bigint() })

const specDir = path.resolve(import.meta.dirname, "specs")

describe("vitest-simple entry point", () => {
  quintTest(test, "replays counter traces via vitest-simple quintTest", {
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
