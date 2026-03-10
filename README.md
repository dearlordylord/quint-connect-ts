# @firfi/quint-connect

[![npm version][npm-badge]][npm-url]
[![CI][ci-badge]][ci-url]
[![Apache-2.0][apache-badge]][apache-url]

[npm-badge]: https://img.shields.io/npm/v/@firfi/quint-connect
[npm-url]: https://www.npmjs.com/package/@firfi/quint-connect
[ci-badge]: https://img.shields.io/github/actions/workflow/status/dearlordylord/quint-connect-ts/mbt.yml?branch=master&label=CI
[ci-url]: https://github.com/dearlordylord/quint-connect-ts/actions/workflows/mbt.yml
[apache-badge]: https://img.shields.io/badge/license-Apache%20License%202.0-blue
[apache-url]: https://github.com/dearlordylord/quint-connect-ts/blob/master/LICENSE

Model-based testing framework connecting [Quint](https://github.com/informalsystems/quint) specifications to TypeScript implementations. The TypeScript equivalent of [quint-connect](https://github.com/informalsystems/quint-connect) (Rust).

Spawns `quint run --mbt`, parses ITF traces, replays them through a user-implemented driver, and optionally compares spec state against implementation state after every step.

## Install

```sh
# Simple API (default):
pnpm add @firfi/quint-connect

# If using Zod ITF schemas (ITFBigInt, ITFSet, ITFMap):
pnpm add zod

# For Effect API:
pnpm add @firfi/quint-connect effect @effect/platform-node

# For Effect vitest helper (quintIt):
pnpm add -D @effect/vitest
```

## Usage

Given a Quint spec `counter.qnt`:

```quint
module counter {
  var count: int
  action init = { count' = 0 }
  action Increment = {
    nondet amount = 1.to(10).oneOf()
    count' = count + amount
  }
  action step = Increment
}
```

Write a driver and run:

```ts
import { defineDriver, run, stateCheck } from "@firfi/quint-connect"
import { ITFBigInt } from "@firfi/itf-trace-parser/zod"
import { z } from "zod"

const CounterState = z.object({ count: z.bigint() })

const result = await run({
  spec: "./counter.qnt",
  nTraces: 10,
  maxSteps: 20,
  seed: "1",
  driver: defineDriver(
    { Increment: { amount: ITFBigInt } },
    () => {
      let count = 0n
      return {
        Increment: ({ amount }) => {       // amount: bigint — inferred from schema
          count += amount
        },
        getState: () => ({ count }),
      }
    }
  ),
  stateCheck: stateCheck(
    (raw) => CounterState.parse(raw),
    (spec, impl) => spec.count === impl.count,
  ),
})

console.log(result.tracesReplayed, result.seed)
```

Per-field pick schemas use [Standard Schema](https://github.com/standard-schema/standard-schema) — Zod, Valibot, ArkType, or any compatible library. ITF values (`{"#bigint":"5"}`) are automatically transformed to native types (`5n`) before schema validation.

State checking is optional — omit `stateCheck` for smoke-testing (verifying the driver doesn't crash on spec actions).

See [examples/counter/counter.test.ts](examples/counter/counter.test.ts) for a complete runnable vitest example.

### Effect API

For full control (custom error channels, services, resource management), import from `@firfi/quint-connect/effect`:

```ts
import { defineDriver, quintRun, stateCheck } from "@firfi/quint-connect/effect"
import { ITFBigInt } from "@firfi/itf-trace-parser/effect"
import { Effect, Schema } from "effect"
import { NodeContext } from "@effect/platform-node"

const CounterState = Schema.Struct({ count: ITFBigInt })

const program = quintRun({
  spec: "./counter.qnt",
  nTraces: 10,
  maxSteps: 20,
  seed: "1",
  driverFactory: defineDriver(
    { Increment: { amount: ITFBigInt } },
    () => {
      let count = 0n
      return {
        Increment: ({ amount }) =>         // bigint — inferred from schema
          Effect.sync(() => {
            count += amount
          }),
        getState: () => Effect.succeed({ count }),
      }
    }
  ),
  stateCheck: stateCheck(
    (raw) => Schema.decodeUnknown(CounterState)(raw).pipe(Effect.orDie),
    (spec, impl) => spec.count === impl.count,
  ),
})

const result = await Effect.runPromise(
  program.pipe(Effect.provide(NodeContext.layer))
)

console.log(result.tracesReplayed, result.seed)
```

See [examples/counter/counter-effect.test.ts](examples/counter/counter-effect.test.ts) for a complete runnable vitest example.

## API

### Simple API (`@firfi/quint-connect`)

- **`defineDriver(schema, factory)`** — define a typed driver with per-field Standard Schema picks. `schema` maps action names to `{ fieldName: StandardSchema }`. `factory` returns handlers (with inferred pick types) + optional `getState`/`config`. Compile error if a handler is missing.
- **`defineDriver(factory)`** — define a raw driver. `factory` returns `{ step, getState?, config? }`. See [Raw mode](#raw-mode).
- **`pickFrom(nondetPicks, key, schema)`** — extract a single pick from raw nondet picks: unwrap Quint Option, transform ITF value, validate with Standard Schema. Returns `T | undefined`.
- **`stateCheck(deserialize, compare)`** — helper that infers the state type from `deserialize` and contextually types `compare`'s parameters. Workaround for TypeScript's inability to infer generics across sibling callbacks in an object literal.
- **`run(opts)`** — generate traces and replay them through a driver. Returns `Promise<{ tracesReplayed, seed }>`.

### Effect API (`@firfi/quint-connect/effect`)

- **`defineDriver(schema, factory)`** — define a driver with per-field Effect Schema picks. Same shape as simple API but handlers return `Effect`.
- **`stateCheck(deserialize, compare)`** — same as simple API but `deserialize` returns `Effect<S>`.
- **`quintRun(opts)`** — generate traces via `quint run --mbt` and replay them through a driver. Returns `Effect<{ tracesReplayed, seed }>`.
- **`generateTraces(opts)`** — just spawn quint and parse ITF traces without replaying.
- **`ItfOption(schema)`** — Effect Schema that decodes Quint's Option variant to `A | undefined`.
- **`ITFBigInt`**, **`ITFSet(item)`**, **`ITFMap(key, value)`** — ITF type schemas.

### `RunOptions`

Shared by `run`, `quintRun`, and `generateTraces`:

| Field | Type | Default | Description |
|---|---|---|---|
| `spec` | `string` | *required* | Path to the `.qnt` spec file |
| `seed` | `string` | random | RNG seed for reproducible runs. Also reads `QUINT_SEED` env var. |
| `nTraces` | `number` | `10` | Number of traces to generate |
| `maxSteps` | `number` | quint default | Maximum steps per trace |
| `maxSamples` | `number` | quint default | Maximum samples before giving up on finding a valid step |
| `init` | `string` | quint default | Name of the init action |
| `step` | `string` | quint default | Name of the step action |
| `main` | `string` | quint default | Name of the main module |
| `backend` | `"typescript" \| "rust"` | `"typescript"` | Simulation backend. TypeScript works out of the box; `"rust"` requires the Rust evaluator. |
| `invariants` | `string[]` | — | Invariant names to check during simulation |
| `witnesses` | `string[]` | — | Witness names to report |
| `verbose` | `boolean` | `false` | Enable `QUINT_VERBOSE` for quint |
| `traceDir` | `string` | temp dir | Directory to write ITF trace files (kept after run) |

`run` additionally accepts:

| Field | Type | Description |
|---|---|---|
| `driver` | `() => { actions, getState?, config? }` | Creates a fresh driver per trace. Use `defineDriver` to create. |
| `stateCheck` | `stateCheck(deserialize, compare)` | Optional. Compare spec vs impl state after each step. Use `stateCheck()` helper for type inference. |

`quintRun` additionally accepts:

| Field | Type | Description |
|---|---|---|
| `driverFactory` | `{ create: () => Effect<Driver<S, E, R>> }` | Creates a fresh driver per trace. Use `defineDriver` to create. |
| `stateCheck` | `stateCheck(deserialize, compare)` | Optional. Compare spec vs impl state after each step. Use `stateCheck()` helper for type inference. |

### Config

Drivers can optionally return a `Config` from `config()`:

| Field | Type | Default | Description |
|---|---|---|---|
| `statePath` | `string[]` | `[]` | Path to extract state subtree for `deserializeState`/`compareState` |
| `nondetPath` | `string[]` | `[]` | Nested path to a sum-type action encoding (Choreo-style specs) |

`statePath` scopes what `deserializeState` and `compareState` receive. If your Quint module wraps all state in a single record variable:

```quint
var routingState: { count: int }
```

Set `statePath: ["routingState"]` so that `deserializeState` receives `{ count: ... }` directly instead of `{ routingState: { count: ... }, "mbt::actionTaken": ..., ... }`.

### Raw mode

For full manual control (no schema, no typed dispatch), use the single-argument `defineDriver(factory)` overload. The factory returns a `step` callback that receives the action name and raw nondet picks:

```ts
import { defineDriver, run, pickFrom } from "@firfi/quint-connect"
import { ITFBigInt } from "@firfi/itf-trace-parser/zod"

const result = await run({
  spec: "./counter.qnt",
  nTraces: 10,
  maxSteps: 20,
  seed: "1",
  driver: defineDriver(() => {
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
  }),
})
```

**`pickFrom(nondetPicks, key, schema)`** extracts a single pick: unwraps the Quint Option (`Some`/`None`), applies `transformITFValue`, and validates with the given Standard Schema. Returns `T | undefined` (`undefined` when the key is missing or `None`).

For fully manual ITF decoding, use the re-exported `transformITFValue` from `@firfi/itf-trace-parser`.

### Deterministic specs

For specs with no `nondet` picks (only one possible execution), use:

```ts
{ nTraces: 1, maxSamples: 1, maxSteps: N }
```

The default `nTraces` is 10, which would generate 10 identical traces for a deterministic spec.

### Backend

The default backend is `"typescript"` (zero extra deps, works out of the box). Override with `backend: "rust"` for the more mature Rust evaluator (requires separate download).

**Known issue:** `--backend typescript` corrupts `mbt::actionTaken` for specs where the step action is a single body (not `any { ... }` with named disjuncts). All states will show `actionTaken: "init"` instead of the actual action name. This is a [Quint bug](https://github.com/informalsystems/quint) in the TypeScript simulator's `Context.shift()` — it doesn't reset metadata between steps. Specs using `any { ... }` are unaffected.

## License

Apache-2.0
