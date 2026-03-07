# @firfi/quint-connect

Model-based testing framework connecting [Quint](https://github.com/informalsystems/quint) specifications to TypeScript implementations. The TypeScript equivalent of [quint-connect](https://github.com/informalsystems/quint-connect) (Rust).

Spawns `quint run --mbt`, parses ITF traces, replays them through a user-implemented driver, and compares spec state against implementation state after every step.

Built on [Effect](https://effect.website/).

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
import { quintRun, pickFrom, ItfBigInt } from "@firfi/quint-connect"
import { Effect, Schema } from "effect"
import { NodeContext } from "@effect/platform-node"

const CounterState = Schema.Struct({ count: ItfBigInt })
type CounterState = typeof CounterState.Type

const createDriver = () => {
  let count = 0n
  return {
    step: (step) =>
      Effect.gen(function*() {
        if (step.action === "Increment") {
          const amount = yield* pickFrom(step, "amount", ItfBigInt)
          if (amount !== undefined) count = count + amount
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

// Run directly or inside any test runner
await Effect.runPromise(
  program.pipe(Effect.provide(NodeContext.layer), Effect.scoped)
)
```

## API

- **`quintRun(opts)`** -- generate traces via `quint run --mbt` and replay them through a driver. Returns `{ tracesReplayed, seed? }`.
- **`generateTraces(opts)`** -- just spawn quint and parse ITF traces without replaying.
- **`pickFrom(step, key, schema)`** -- extract a nondet pick from a step, unwrapping Quint's `Some`/`None` Option encoding.
- **`ItfOption(schema)`** -- Effect Schema that decodes Quint's Option variant (`{ tag: "Some", value }` / `{ tag: "None", ... }`) to `A | undefined`.
- **`ItfBigInt`**, **`ItfSet(item)`**, **`ItfMap(key, value)`** -- ITF special type decoders.

See [SPEC.md](SPEC.md) for design rationale and architecture.

## License

Apache-2.0
