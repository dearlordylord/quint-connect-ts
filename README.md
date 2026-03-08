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
pnpm add @firfi/quint-connect
```

Peer dependency: `quint` CLI available via npx (`npx @informalsystems/quint`).

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
import { run, pick, decodeBigInt } from "@firfi/quint-connect"

type CounterState = { count: bigint }

const createDriver = () => {
  let count = 0n
  return {
    step(step) {
      if (step.action === "Increment") {
        const amount = pick(step, "amount", decodeBigInt)
        if (amount !== undefined) count += amount
      }
    },
    getState: () => ({ count })
  }
}

const result = await run({
  spec: "./counter.qnt",
  nTraces: 10,
  maxSteps: 20,
  seed: "1",
  createDriver,
  stateCheck: {
    compareState: (spec: CounterState, impl: CounterState) => spec.count === impl.count,
    deserializeState: (raw) => ({ count: decodeBigInt((raw as any).count) })
  }
})

console.log(result.tracesReplayed, result.seed)
```

State checking is optional -- omit `stateCheck` for smoke-testing (verifying the driver doesn't crash on spec actions).

### Effect API

For full control (custom error channels, services, resource management), import from `@firfi/quint-connect/effect`:

```ts
import { quintRun, pickFrom, ITFBigInt } from "@firfi/quint-connect/effect"
import { Effect, Schema } from "effect"
import { NodeContext } from "@effect/platform-node"

const CounterState = Schema.Struct({ count: ITFBigInt })
type CounterState = typeof CounterState.Type

const createDriver = () => {
  let count = 0n
  return {
    step: (step) =>
      Effect.gen(function*() {
        if (step.action === "Increment") {
          const amount = yield* pickFrom(step, "amount", ITFBigInt)
          if (amount !== undefined) count += amount
        }
      }),
    getState: () => Effect.succeed({ count })
  }
}

const program = quintRun({
  spec: "./counter.qnt",
  nTraces: 10,
  maxSteps: 20,
  seed: "1",
  driverFactory: { create: () => Effect.succeed(createDriver()) },
  stateCheck: {
    compareState: (spec, impl) => spec.count === impl.count,
    deserializeState: (raw) => Schema.decodeUnknown(CounterState)(raw).pipe(Effect.orDie)
  }
})

const result = await Effect.runPromise(
  program.pipe(Effect.provide(NodeContext.layer))
)

console.log(result.tracesReplayed, result.seed)
```

## API

### Simple API (`@firfi/quint-connect`)

- **`run(opts)`** -- generate traces and replay them through a driver. Returns `Promise<{ tracesReplayed, seed }>`.
- **`pick(step, key)`** -- extract a nondet pick, unwrapping Quint's Option encoding. Returns `unknown | undefined`.
- **`pick(step, key, decode)`** -- same, but applies `decode` to the raw value. Returns `A | undefined`.
- **`decodeBigInt`**, **`decodeSet(raw, decodeItem)`**, **`decodeMap(raw, decodeKey, decodeValue)`** -- sync ITF type decoders.

### Effect API (`@firfi/quint-connect/effect`)

- **`quintRun(opts)`** -- generate traces via `quint run --mbt` and replay them through a driver. Returns `Effect<{ tracesReplayed, seed }>`.
- **`generateTraces(opts)`** -- just spawn quint and parse ITF traces without replaying.
- **`pickFrom(step, key, schema)`** -- extract a nondet pick from a step using an Effect Schema.
- **`ItfOption(schema)`** -- Effect Schema that decodes Quint's Option variant to `A | undefined`.
- **`ITFBigInt`**, **`ITFSet(item)`**, **`ITFMap(key, value)`** -- ITF type schemas.

### `RunOptions`

Shared by `run`, `quintRun`, and `generateTraces`:

| Field | Type | Default | Description |
|---|---|---|---|
| `spec` | `string` | *required* | Path to the `.qnt` spec file |
| `seed` | `string` | random | RNG seed for reproducible runs. Also reads `QUINT_SEED` env var. |
| `nTraces` | `number` | `100` | Number of traces to generate |
| `maxSteps` | `number` | quint default | Maximum steps per trace |
| `maxSamples` | `number` | quint default | Maximum samples before giving up on finding a valid step |
| `init` | `string` | quint default | Name of the init action |
| `step` | `string` | quint default | Name of the step action |
| `main` | `string` | quint default | Name of the main module |
| `backend` | `"typescript" \| "rust"` | quint CLI default (`rust`) | Simulation backend. Omit to use quint's default. |
| `invariants` | `string[]` | — | Invariant names to check during simulation |
| `witnesses` | `string[]` | — | Witness names to report |
| `verbose` | `boolean` | `false` | Enable `QUINT_VERBOSE` for quint |
| `traceDir` | `string` | temp dir | Directory to write ITF trace files (kept after run) |

`run` additionally accepts:

| Field | Type | Description |
|---|---|---|
| `createDriver` | `() => SimpleDriver<S>` | Creates a fresh driver per trace |
| `stateCheck` | `{ compareState, deserializeState }` | Optional. Compare spec vs impl state after each step |

`quintRun` additionally accepts:

| Field | Type | Description |
|---|---|---|
| `driverFactory` | `DriverFactory<S, E, R>` | Creates a fresh driver per trace |
| `stateCheck` | `{ compareState, deserializeState }` | Optional. Compare spec vs impl state after each step |

### Config

Drivers can optionally return a `Config` from `config()`:

| Field | Type | Default | Description |
|---|---|---|---|
| `statePath` | `string[]` | `[]` | Path to extract state subtree for `deserializeState`/`compareState` |
| `nondetPath` | `string[]` | `[]` | Nested path to a sum-type action encoding (Choreo-style specs) |

`statePath` scopes what `deserializeState` and `compareState` receive, but does **not** affect `step.rawState` (which always contains the full ITF state including MBT metadata). If your Quint module wraps all state in a single record variable:

```quint
var routingState: { count: int }
```

Set `statePath: ["routingState"]` so that `deserializeState` receives `{ count: ... }` directly instead of `{ routingState: { count: ... }, "mbt::actionTaken": ..., ... }`.

### Deterministic specs

For specs with no `nondet` picks (only one possible execution), use:

```ts
{ nTraces: 1, maxSamples: 1, maxSteps: N }
```

The default `nTraces` is 100, which would generate 100 identical traces for a deterministic spec.

### Backend

By default, quint-connect does not force a backend — quint uses its own default (`rust`). You can override with `backend: "typescript"` (zero extra deps, faster cold start) or `backend: "rust"` (more mature).

**Known issue:** `--backend typescript` corrupts `mbt::actionTaken` for specs where the step action is a single body (not `any { ... }` with named disjuncts). All states will show `actionTaken: "init"` instead of the actual action name. This is a [Quint bug](https://github.com/informalsystems/quint) in the TypeScript simulator's `Context.shift()` — it doesn't reset metadata between steps. Specs using `any { ... }` are unaffected.

## License

Apache-2.0
