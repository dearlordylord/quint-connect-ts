# @firfi/quint-connect

Model-based testing framework connecting [Quint](https://github.com/informalsystems/quint) specifications to TypeScript implementations. The TypeScript equivalent of [quint-connect](https://github.com/informalsystems/quint-connect) (Rust).

Spawns `quint run --mbt`, parses ITF traces, replays them through a user-implemented driver, and compares spec state against implementation state after every step.

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

await run({
  spec: "./counter.qnt",
  nTraces: 10,
  maxSteps: 20,
  seed: "1",
  createDriver,
  compareState: (spec: CounterState, impl: CounterState) => spec.count === impl.count,
  deserializeState: (raw) => ({ count: decodeBigInt((raw as any).count) })
})
```

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
  compareState: (spec, impl) => spec.count === impl.count,
  deserializeState: (raw) => Schema.decodeUnknown(CounterState)(raw).pipe(Effect.orDie)
})

await Effect.runPromise(
  program.pipe(Effect.provide(NodeContext.layer))
)
```

## API

### Simple API (`@firfi/quint-connect`)

- **`run(opts)`** -- generate traces and replay them through a driver. Returns `Promise<{ tracesReplayed }>`.
- **`pick(step, key)`** -- extract a nondet pick, unwrapping Quint's Option encoding. Returns `unknown | undefined`.
- **`pick(step, key, decode)`** -- same, but applies `decode` to the raw value. Returns `A | undefined`.
- **`decodeBigInt`**, **`decodeSet(raw, decodeItem)`**, **`decodeMap(raw, decodeKey, decodeValue)`** -- sync ITF type decoders.

### Effect API (`@firfi/quint-connect/effect`)

- **`quintRun(opts)`** -- generate traces via `quint run --mbt` and replay them through a driver. Returns `Effect<{ tracesReplayed }>`.
- **`generateTraces(opts)`** -- just spawn quint and parse ITF traces without replaying.
- **`pickFrom(step, key, schema)`** -- extract a nondet pick from a step using an Effect Schema.
- **`ItfOption(schema)`** -- Effect Schema that decodes Quint's Option variant to `A | undefined`.
- **`ITFBigInt`**, **`ITFSet(item)`**, **`ITFMap(key, value)`** -- ITF type schemas.

### `RunOptions`

Shared by `run`, `quintRun`, and `generateTraces`:

| Field | Type | Default | Description |
|---|---|---|---|
| `spec` | `string` | *required* | Path to the `.qnt` spec file |
| `seed` | `string` | random | RNG seed for reproducible runs |
| `nTraces` | `number` | `100` | Number of traces to generate |
| `maxSteps` | `number` | quint default | Maximum steps per trace |
| `maxSamples` | `number` | quint default | Maximum samples before giving up on finding a valid step |
| `init` | `string` | quint default | Name of the init action |
| `step` | `string` | quint default | Name of the step action |
| `main` | `string` | quint default | Name of the main module |

`run` additionally requires:

| Field | Type | Description |
|---|---|---|
| `createDriver` | `() => SimpleDriver<S>` | Creates a fresh driver per trace |
| `compareState` | `(spec: S, impl: S) => boolean` | Compares spec state against implementation state |
| `deserializeState` | `(raw: unknown) => S` | Decodes raw ITF state into your typed state |

`quintRun` additionally requires:

| Field | Type | Description |
|---|---|---|
| `driverFactory` | `DriverFactory<S, E, R>` | Creates a fresh driver per trace |
| `compareState` | `(spec: S, impl: S) => boolean` | Compares spec state against implementation state |
| `deserializeState` | `(raw: unknown) => Effect<S>` | Decodes raw ITF state into your typed state |


## License

Apache-2.0
