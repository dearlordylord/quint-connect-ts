---
name: quint-connect-ts-setup
description: >
  Scaffold a quint-connect model-based test from a Quint spec. Covers
  defineDriver (typed mode with per-field picks, raw mode with step callback),
  run/quintRun, stateCheck, RunOptions (spec, nTraces, maxSteps, seed, backend),
  simple API (@firfi/quint-connect, Standard Schema) vs Effect API
  (@firfi/quint-connect/effect, Effect Schema), vitest helpers (quintTest,
  quintIt), Config (statePath, nondetPath), pickFrom. Use when setting up a
  new quint-connect test, wiring a driver, choosing an API surface, or adding
  state checking.
type: core
library: quint-connect-ts
library_version: "0.6.0"
sources:
  - "dearlordylord/quint-connect-ts:README.md"
  - "dearlordylord/quint-connect-ts:src/simple.ts"
  - "dearlordylord/quint-connect-ts:src/effect.ts"
  - "dearlordylord/quint-connect-ts:src/runner/runner.ts"
  - "dearlordylord/quint-connect-ts:src/vitest.ts"
  - "dearlordylord/quint-connect-ts:src/vitest-simple.ts"
  - "dearlordylord/quint-connect-ts:examples/counter/counter.test.ts"
  - "dearlordylord/quint-connect-ts:examples/counter/counter-effect.test.ts"
---

# quint-connect-ts -- Setup MBT Test

## Prerequisites

- Node.js 21+ (for `import.meta.dirname`)
- ESM project (`"type": "module"` in package.json)
- Quint CLI on PATH (`npx @informalsystems/quint` works without global install)

## Setup -- Simple API (recommended default)

```bash
pnpm add -D @firfi/quint-connect
# For Zod ITF schemas (ITFBigInt, ITFSet, ITFMap):
pnpm add -D zod
```

Given a Quint spec `specs/counter.qnt`:

```quint
module counter {
  var count: int
  action init = { count' = 0 }
  action Increment = {
    nondet amount = Set(1, 2, 3).oneOf()
    count' = count + amount
  }
  action step = any { Increment }
}
```

Complete test file:

```ts
import * as path from "node:path"
import { describe } from "vitest"
import { z } from "zod"
import { defineDriver, stateCheck } from "@firfi/quint-connect"
import { ITFBigInt } from "@firfi/quint-connect/zod"
import { quintTest } from "@firfi/quint-connect/vitest-simple"

const CounterState = z.object({ count: z.bigint() })

const counterDriver = defineDriver(
  { Increment: { amount: ITFBigInt } },
  () => {
    let count = 0n
    return {
      Increment: ({ amount }) => {
        count += amount
      },
      getState: () => ({ count }),
    }
  }
)

describe("Counter MBT", () => {
  quintTest("replays traces", {
    spec: path.join(import.meta.dirname, "specs", "counter.qnt"),
    driver: counterDriver,
    stateCheck: stateCheck(
      (raw) => CounterState.parse(raw),
      (spec, impl) => spec.count === impl.count,
    ),
  })
})
```

## Setup -- Effect API

```bash
pnpm add -D @firfi/quint-connect effect @effect/platform-node
# For Effect vitest helper:
pnpm add -D @effect/vitest
```

```ts
import { Effect, Schema } from "effect"
import { NodeContext } from "@effect/platform-node"
import * as path from "node:path"
import { describe } from "vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"

const CounterState = Schema.Struct({ count: ITFBigInt })

const counterDriver = defineDriver(
  { Increment: { amount: ITFBigInt } },
  () => {
    let count = 0n
    return {
      Increment: ({ amount }) =>
        Effect.sync(() => { count += amount }),
      getState: () => Effect.succeed({ count }),
    }
  }
)

describe("Counter MBT (Effect)", () => {
  quintIt("replays traces", {
    spec: path.join(import.meta.dirname, "specs", "counter.qnt"),
    driverFactory: counterDriver,
    stateCheck: stateCheck(
      (raw) => Schema.decodeUnknown(CounterState)(raw).pipe(Effect.orDie),
      (spec, impl) => spec.count === impl.count,
    ),
  })
})
```

## Core Patterns

### Add an action with no nondet picks

Actions without `nondet` use an empty schema object:

```ts
const driver = defineDriver(
  { Increment: { amount: ITFBigInt }, Reset: {} },
  () => {
    let count = 0n
    return {
      Increment: ({ amount }) => { count += amount },
      Reset: () => { count = 0n },
      getState: () => ({ count }),
    }
  }
)
```

### Use raw step() mode for manual control

Single-argument `defineDriver` overload. Receives action name and raw nondet picks:

```ts
import { defineDriver, run, pickFrom } from "@firfi/quint-connect"
import { ITFBigInt } from "@firfi/quint-connect/zod"

const driver = defineDriver(() => {
  let count = 0n
  return {
    step: (action, nondetPicks) => {
      if (action === "Increment") {
        const amount = pickFrom(nondetPicks, "amount", ITFBigInt)
        if (amount !== undefined) count += amount
      }
    },
    getState: () => ({ count }),
  }
})
```

### Use statePath for nested state

When the Quint spec wraps state in a record variable:

```quint
var routingState: { count: int }
```

```ts
const driver = defineDriver({ Increment: { amount: ITFBigInt } }, () => {
  let count = 0n
  return {
    Increment: ({ amount }) => { count += amount },
    getState: () => ({ count }),
    config: () => ({ statePath: ["routingState"] }),
  }
})
```

### Tune trace generation

```ts
await run({
  spec: specPath,
  driver: myDriver,
  nTraces: 10,       // number of random traces (default: 10)
  maxSteps: 50,      // max steps per trace (default: quint default)
  seed: "0x138ff8c9", // deterministic seed for reproduction
  backend: "typescript", // or "rust" for the Rust evaluator
  traceDir: "./traces", // persist ITF files for debugging
})
```

### Run without state checking (smoke test)

Omit `stateCheck` to verify the driver doesn't crash on spec actions:

```ts
await run({
  spec: specPath,
  driver: myDriver,
  nTraces: 10,
})
```

## Common Mistakes

### CRITICAL Shared mutable state across traces

Wrong:

```ts
let count = 0n
const driver = defineDriver({ Increment: { amount: ITFBigInt } }, () => ({
  Increment: ({ amount }) => { count += amount },
  getState: () => ({ count }),
}))
```

Correct:

```ts
const driver = defineDriver({ Increment: { amount: ITFBigInt } }, () => {
  let count = 0n
  return {
    Increment: ({ amount }) => { count += amount },
    getState: () => ({ count }),
  }
})
```

State must be created inside the factory function. The factory is called once per trace. State outside the factory accumulates across all traces, causing nondeterministic failures.

Source: README.md, src/simple.ts

### HIGH Hallucinate createDriver or makeDriver

Wrong:

```ts
import { createDriver } from "@firfi/quint-connect"
```

Correct:

```ts
import { defineDriver } from "@firfi/quint-connect"
```

The API is `defineDriver`, not `createDriver`, `makeDriver`, or `newDriver`.

Source: src/simple.ts, src/effect.ts

### HIGH Import from wrong entry point

Wrong:

```ts
// Using Effect Schema picks but importing from simple API
import { defineDriver } from "@firfi/quint-connect"
import { ITFBigInt } from "@firfi/quint-connect/effect"
```

Correct:

```ts
// Effect API: all imports from /effect
import { defineDriver, ITFBigInt } from "@firfi/quint-connect/effect"
```

The simple API (`@firfi/quint-connect`) uses Standard Schema (Zod, Valibot). The Effect API (`@firfi/quint-connect/effect`) uses Effect Schema. Mixing them compiles but produces wrong runtime behavior.

Source: package.json exports

### HIGH Forget Effect.provide(NodeContext.layer)

Wrong:

```ts
const result = await Effect.runPromise(quintRun(opts))
```

Correct:

```ts
const result = await Effect.runPromise(
  quintRun(opts).pipe(Effect.provide(NodeContext.layer))
)
```

The Effect API requires `@effect/platform-node` services for filesystem access and subprocess spawning. Without `NodeContext.layer`, you get a cryptic missing-service error at runtime.

Source: README.md, src/cli/quint.ts

### HIGH Destructure traces or state from quintRun result

Wrong:

```ts
const { traces, states } = await Effect.runPromise(quintRun(opts).pipe(...))
```

Correct:

```ts
const { tracesReplayed, seed } = await Effect.runPromise(quintRun(opts).pipe(...))
```

`quintRun` returns `{ tracesReplayed: number, seed: string }`, not traces or state data.

Source: src/runner/runner.ts

### MEDIUM Add test framework lifecycle hooks for state reset

Wrong:

```ts
let count = 0n
beforeEach(() => { count = 0n })
test("counter", async () => {
  await run({ driver: defineDriver(...) })
})
```

Correct:

```ts
test("counter", async () => {
  await run({
    driver: defineDriver({ Increment: { amount: ITFBigInt } }, () => {
      let count = 0n
      return { Increment: ({ amount }) => { count += amount } }
    }),
  })
})
```

quint-connect handles per-trace state reset via the factory pattern. `beforeEach`/`afterEach` hooks are unnecessary and can conflict.

Source: maintainer interview

### HIGH Tension: setup simplicity vs production robustness

Simple setup patterns (`Effect.orDie`, `nTraces: 1`, partial state comparison) work for prototyping but mask bugs in production. Use `nTraces: 10+`, compare all state fields, and let decode errors propagate as structured `TraceReplayError` with trace/step context.

See also: quint-connect-ts-debug/SKILL.md

See also: quint-connect-ts-itf-decoding/SKILL.md -- ITF schemas are required for picks and state decoding
