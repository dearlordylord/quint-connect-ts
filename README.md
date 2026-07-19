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

Spawns `quint run --mbt` or one exact named `quint test`, parses ITF traces, replays them through a user-implemented driver, and optionally compares spec state against implementation state after every step.

## Install

```sh
# Simple API (default):
pnpm add @firfi/quint-connect

# If using Zod ITF schemas (ITFBigInt, ITFSet, ITFMap) — requires Zod 4+:
pnpm add zod

# For the Effect 4 prerelease API (npm latest remains on Effect 3):
pnpm add @firfi/quint-connect@effect4 effect@4.0.0-beta.99

# For Effect vitest helper (quintIt):
pnpm add -D @effect/vitest@4.0.0-beta.99
```

The `effect4` prerelease line targets Effect `4.0.0-beta.99`. The untagged `latest` package continues to distribute the Effect 3 build.

**Requirements:** Node.js 22+ (for lossless evaluator JSON decoding), ESM (`"type": "module"` in package.json), and the [Quint CLI](https://github.com/informalsystems/quint). The launcher uses `quintBin`, then `QUINT_BIN`, then `quint` on `PATH`; only when the default `PATH` lookup fails does it fall back to `npx @informalsystems/quint`.

## Usage

Given a Quint spec `counter.qnt`:

```quint
module counter {
  var count: int
  action init = { count' = 0 }
  action Increment = {
    nondet amount = Set(1, 2, 3).oneOf()
    count' = count + amount
  }
  action step = any {
    Increment,
  }
}
```

Write a driver and run:

```ts
import { defineDriver, run, stateCheck } from "@firfi/quint-connect"
import { ITFBigInt } from "@firfi/quint-connect/zod"
import { z } from "zod"

const CounterState = z.object({ count: z.bigint() })

const result = await run({
  spec: "./counter.qnt",
  nTraces: 10,
  maxSteps: 20,
  seed: "1",
  driver: defineDriver(
    { init: {}, Increment: { amount: ITFBigInt } },
    () => {
      let count = 0n
      return {
        init: () => {},
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

### ITF Type Mappings

All Quint values are automatically transformed from ITF encoding to native JS types before schema validation:

| Quint type | JS type | Schema |
|---|---|---|
| `int` | `bigint` | `ITFBigInt` / `z.bigint()` |
| `str` | `string` | `z.string()` |
| `bool` | `boolean` | `z.boolean()` |
| `Set(T)` | `Set<T>` | `ITFSet(inner)` / `z.set(inner)` |
| `T -> U` (Map) | `Map<K,V>` | `ITFMap(k, v)` / `z.map(k, v)` |
| `(T1, T2)` (Tuple) | `[T1, T2]` | `z.tuple([...])` |
| `{ field: T }` (Record) | `{ field: T }` | `z.object({ field: ... })` |

**Note:** All Quint `int` values become `bigint`, not `number`. Use `0n` literals and `z.bigint()` / `ITFBigInt`.

See [examples/counter/counter.test.ts](examples/counter/counter.test.ts) for a complete runnable vitest example.

### Effect API

For full control (custom error channels, services, resource management), import from `@firfi/quint-connect/effect`:

```ts
import { defineDriver, quintRun, stateCheck, ITFBigInt } from "@firfi/quint-connect/effect"
import { Effect, Schema } from "effect"

const CounterState = Schema.Struct({ count: ITFBigInt })

const result = await Effect.runPromise(
  quintRun({
    spec: "./counter.qnt",
    nTraces: 10,
    maxSteps: 20,
    seed: "1",
    driverFactory: defineDriver(
      { init: {}, Increment: { amount: ITFBigInt } },
      () => {
        let count = 0n
        return {
          init: () => Effect.void,
          Increment: ({ amount }) =>         // bigint — inferred from schema
            Effect.sync(() => {
              count += amount
            }),
          getState: () => Effect.succeed({ count }),
        }
      }
    ),
    stateCheck: stateCheck(
      (raw) => Schema.decodeUnknownEffect(CounterState)(raw).pipe(Effect.orDie),
      (spec, impl) => spec.count === impl.count,
    ),
  })
)

console.log(result.tracesReplayed, result.seed)
```

No `Effect.scoped` or `Effect.provide` needed — resource management and Node.js services are handled internally.

Action-pick schemas and schemas passed to `ItfOption` must be service-free codecs. Decoding happens inside the driver boundary, which does not accept a layer for schema services.

See [examples/counter/counter-effect.test.ts](examples/counter/counter-effect.test.ts) for a complete runnable vitest example.

### Vitest Helpers

Simple API helper (no Effect dependency needed):

```ts
import { quintTest } from "@firfi/quint-connect/vitest-simple"
import { test } from "vitest"

quintTest(test, "my test", {
  spec: "./myspec.qnt",
  driver: myDriver,
})
```

Effect API helper (requires `@effect/vitest`):

```ts
import { quintIt } from "@firfi/quint-connect/vitest"
import { it } from "@effect/vitest"

quintIt(it.effect, "my test", {
  spec: "./myspec.qnt",
  driverFactory: myDriver,
})
```

The first argument is the test function from your own vitest/`@effect/vitest` instance — this avoids vitest instance collisions when the library and your project use different vitest versions. Both accept an optional fourth argument for timeout (default: 30s).

## API

### Simple API (`@firfi/quint-connect`)

- **`defineDriver(schema, factory)`** — define a typed driver with per-field Standard Schema picks. `schema` maps action names to `{ fieldName: StandardSchema }`. `factory` returns handlers (with inferred pick types) + optional `getState`/`config`. Compile error if a handler is missing. Actions with no `nondet` picks use an empty schema: `{ Toggle: {} }`.
- **`stateCheck(deserialize, compare)`** — helper that infers the state type from `deserialize` and contextually types `compare`'s parameters. Needed because TypeScript cannot infer generic type parameters across sibling callbacks in an object literal.
- **`run(opts)`** — generate traces and replay them through a driver. Returns `Promise<{ tracesReplayed, seed }>`.

### Effect API (`@firfi/quint-connect/effect`)

- **`defineDriver(schema, factory)`** — define a driver with per-field Effect Schema picks. Same shape as simple API but handlers return `Effect`.
- **`stateCheck(deserialize, compare)`** — same as simple API but `deserialize` returns `Effect<S>`.
- **`quintRun(opts)`** — generate traces via `quint run --mbt` and replay them through a driver. Returns `Effect<{ tracesReplayed, seed }>`.
- **`quintRunWithTraceGeneration(opts)`** — the injectable orchestration variant. It requires the `TraceGeneration` Effect service; provide a fake layer to test generation and replay without subprocesses or files.
- **`generateTraces(opts)`** — just spawn quint and parse ITF traces without replaying.
- **`ItfOption(schema)`** — Effect Schema that decodes Quint's Option variant to `A | undefined`.
- **`ITFBigInt`**, **`ITFSet(item)`**, **`ITFMap(key, value)`** — ITF type schemas.

### `RunOptions`

Shared by `run`, `quintRun`, and `generateTraces`:

| Field | Type | Default | Description |
|---|---|---|---|
| `spec` | `string` | *required* | Path to the `.qnt` spec file |
| `generation` | `{ mode: "test", test: string }` | `{ mode: "run" }` | Generate replay traces from exactly one named Quint test instead of `quint run --mbt`. |
| `seed` | `string` | random | RNG seed for reproducible runs. Must be a big integer: decimal (`"42"`) or hex (`"0x138ff8c9"`). Also reads `QUINT_SEED` env var as fallback. When omitted, a random hex seed is generated and returned in `result.seed` for reproducibility. |
| `nTraces` | `number` | `10` | Run mode only: number of simulation traces to generate |
| `maxSteps` | `number` | quint default | Run mode only: maximum steps per trace |
| `maxSamples` | `number` | run: quint default; test: `10` | Run mode: maximum samples before giving up on a valid step. Test mode: successful randomized test executions requested from Quint. |
| `init` | `string` | quint default | Run mode only: name of the init action |
| `step` | `string` | quint default | Run mode only: name of the step action |
| `main` | `string` | quint default | Name of the main module. Required when the `.qnt` file contains multiple modules. |
| `backend` | `"typescript" \| "rust"` | `QUINT_BACKEND`, then `"typescript"` | Simulation backend. TypeScript works out of the box; `"rust"` requires the Rust evaluator. A present `QUINT_BACKEND` must be exactly `typescript` or `rust`; malformed values fail before Quint starts. |
| `quintBin` | `string` | `QUINT_BIN`, then `quint` on `PATH` | Exact Quint executable path or command. An explicit value never falls back to `npx`, which is useful for pinned mise/Nix/toolchain installations. |
| `invariants` | `string[]` | — | Run mode only: invariant names to check during simulation |
| `witnesses` | `string[]` | — | Run mode only: witness names to report |
| `verbose` | `boolean` | `false` | Sets `QUINT_VERBOSE=true`. Quint logs detailed simulation output to stderr. |
| `traceDir` | `string` | temp dir | Directory to write ITF trace files. Files are kept after run. Useful for debugging — inspect generated traces when a test fails. |
| `compiledInput` | `string` | — | Run mode only: path to Quint's compiled Rust evaluator input. When present and readable, replay uses the compiled evaluator directly. |

Named-test mode uses an escaped, anchored `quint test --match` expression, so only the requested test runs:

```ts
quintRun({
  ...options,
  generation: { mode: "test", test: "commitScenario" },
  maxSamples: 10,
})
```

`quint test` does not provide Quint's `--mbt` instrumentation. The selected Quint run must therefore store its replay action in the state as `{ tag: string, value: record }`; point the driver at that field with `config: () => ({ nondetPath: ["replayAction"] })`. Both generation modes then use the same validated ITF and replay pipeline. Test mode accepts `maxSamples`; run-only fields such as `nTraces`, `maxSteps`, `init`, `step`, invariants, witnesses, and `compiledInput` are excluded by the public TypeScript contract.

`run` additionally accepts:

| Field | Type | Description |
|---|---|---|
| `driver` | `() => SimpleDriver<State>` | Creates a fresh action-map driver per trace. Use `defineDriver` to create. |
| `stateCheck` | `stateCheck(deserialize, compare)` | Optional. Compare spec vs impl state after each step. Use `stateCheck()` helper for type inference. |

`quintRun` additionally accepts:

| Field | Type | Description |
|---|---|---|
| `driverFactory` | `{ create: () => Effect<Driver<S, E, R>> }` | Creates a fresh action-map driver per trace. Use `defineDriver` to create. |
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

When using `statePath`, both `deserializeState` and `getState` should work with the scoped state shape (e.g. `{ count }`, not `{ routingState: { count } }`).

### Init action handling

Step 0 (the init state) is processed like any other action, matching the Rust [quint-connect](https://github.com/informalsystems/quint-connect) behavior. The `mbt::actionTaken` field determines the action name.

With the **Rust backend** (`backend: "rust"`), init has a proper action name (e.g. `"Init"`) — define it in your action map if you want it dispatched. If it is not mapped, replay fails with `TraceReplayError`; if it is mapped, state comparison runs at step 0 too.

With the **TypeScript backend** (default), some traces report an empty `mbt::actionTaken` at step 0; only that empty placeholder is skipped. If the trace reports a non-empty action such as `"init"`, define that action in your map or replay fails with `TraceReplayError`.

### Additional Exports

**`@firfi/quint-connect/effect`** also exports: `ITFList`, `ITFTuple`, `ITFVariant`, `ITFUnserializable`, `ItfTrace`, `MbtMeta`, `UntypedTraceSchema`, `generateTraces`, `TraceGeneration`, `traceGenerationLayer`, `defaultConfig`.

**`@firfi/quint-connect`** also exports: `transformITFValue`, `defaultConfig`.

**`@firfi/quint-connect/zod`** also exports: `TraceCodec`.

### Error Handling

The library exports typed error classes for programmatic error handling:

| Error | Trigger |
|---|---|
| `TraceReplayError` | Unknown action, handler failure, decode failure |
| `StateMismatchError` | `compareState` returns `false` |
| `QuintError` | `quint run` or `quint test` exits non-zero (includes stderr output) |
| `QuintNotFoundError` | `quint` CLI not found |
| `NoTracesError` | trace generation produced no traces |

**Simple API** — use `instanceof`:

```ts
import { run, StateMismatchError, TraceReplayError } from "@firfi/quint-connect"

try {
  await run(opts)
} catch (e) {
  if (e instanceof StateMismatchError) {
    console.log(e.expected, e.actual, e.traceIndex, e.stepIndex)
  }
}
```

**Effect API** — use `catchTag`:

```ts
quintRun(opts).pipe(
  Effect.catchTag("StateMismatchError", (e) =>
    Effect.log(e.expected, e.actual)),
)
```

`StateMismatchError` has `traceIndex`, `stepIndex`, `expected`, `actual`. `TraceReplayError` has `traceIndex`, `stepIndex`, `action`, `cause`.

### Deterministic specs

For specs with no `nondet` picks (only one possible execution), use:

```ts
{ nTraces: 1, maxSamples: 1, maxSteps: N }
```

The default `nTraces` is 10, which would generate 10 identical traces for a deterministic spec.

### Backend

The default backend is `"typescript"` (zero extra deps, works out of the box). Override with `backend: "rust"` for the more mature Rust evaluator (requires separate download).

**Known issue:** `--backend typescript` corrupts `mbt::actionTaken` for specs where the step action is a single body (not `any { ... }` with named disjuncts). All states will show `actionTaken: "init"` instead of the actual action name. This is a [Quint bug](https://github.com/informalsystems/quint) in the TypeScript simulator's `Context.shift()` — it doesn't reset metadata between steps. Wrap the step in `any { NamedAction, }` so action names are retained, or use `backend: "rust"`.

## License

Apache-2.0
