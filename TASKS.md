# Tasks

## Typed Action Dispatch

Breaking change. Replace untyped `step(Step)` with declarative action→schema→handler map.

### Context

- `Step` is `{ action: string, nondetPicks: ReadonlyMap<string, unknown> }` — forces manual `switch` + `pick()` at every call site
- `pickAllFrom(step, Schema.Struct)` already decodes all picks for one action (src/itf/picks.ts)
- `ItfOption`, `ITFBigInt`, `ITFSet`, etc. already handle ITF wire types (via @firfi/itf-trace-parser)
- Runner skips step 0 (init state) — no init handler needed (runner.ts:98)
- Codegen from .qnt deferred — quint has no stable AST export for external tools

### Target API

Effect:
```ts
quintRun({
  spec: "./counter.qnt",
  driverFactory: defineDriver(
    { Increment: { amount: ITFBigInt } },
    () => {
      let count = 0n
      return {
        Increment: ({ amount }) => Effect.sync(() => { count += amount }),
        getState: () => Effect.succeed({ count }),
      }
    }
  ),
  stateCheck: { ... },
})
```

Simple:
```ts
run({
  spec: "./counter.qnt",
  driver: defineDriver(
    { Increment: { amount: ITFBigInt } },
    () => {
      let count = 0n
      return {
        Increment: ({ amount }) => { count += amount },
        getState: () => ({ count }),
      }
    }
  ),
  stateCheck: { ... },
})
```

### Plan

#### 1. Types (src/driver/types.ts)

- Define `ActionDef<Picks, E, R>` — `{ picks: Schema.Struct<...>, handler: (picks: Picks) => Effect<void, E, R> }`
- Define `ActionMap<E, R>` — `Record<string, ActionDef<any, E, R>>` with inference helper
- Keep `Config` (statePath, nondetPath) unchanged
- Keep action metadata internal to the runner and remove raw step from the public driver shape
- Remove `Driver.step()` — replaced by action map
- Keep `getState` and `config` as top-level driver hooks alongside `actions`
- Keep `DriverFactory` for per-trace driver isolation

Decision: keep `DriverFactory.create()` for per-trace isolation. Today each trace gets a fresh driver, and action handlers often close over mutable implementation state. Options considered:
  - (a) Keep a factory: `createDriver: () => { actions, getState, config }` — simplest, matches current pattern
  - (b) Add explicit `reset()` callback
  - (c) `actions` in options + `createState: () => S` factory for per-trace state

Chose (a) — least change, users already understand the factory pattern.

#### 2. Simple API types (src/simple.ts)

- `SimpleActionMap` stays action-map first: `{ actions, getState?, config? }`
- `defineDriver(schema, factory)` infers each handler's pick object from the Standard Schema fields
- `SimpleRunOptions` keeps `driver: () => { actions, getState?, config? }` for per-trace isolation
- Remove the raw `defineDriver(factory)` overload and `pickFrom` public export

#### 3. Runner dispatch (src/runner/runner.ts)

- After extracting `action` + `nondetPicks` from MBT metadata (unchanged)
- Look up `actions[action]` — fail with `TraceReplayError` if action not in map (unknown action from spec)
- Decode picks from `actionDef.picks`
- Call `actionDef.handler(decodedPicks)`
- State check logic unchanged

Roughly:
```ts
const actionDef = driver.actions[action]
if (!actionDef) return yield* new TraceReplayError({ message: `Unknown action: ${action}`, ... })
const picks = yield* decode(Object.fromEntries(nondetPicks))
yield* actionDef.handler(picks)
```

#### 4. Wrapper in simple.ts

- `wrapDriver` adapts simple actions to Effect actions:
  - For each action: expose `Schema.Unknown` fields for the runner's Option unwrap
  - Wrap sync/async handler into `Effect.promise`

Key type challenge: bridging `{ amount: decodeBigInt }` (sync codec record) to `Schema.Struct({ amount: SomeSchema })`. Two approaches:
  - (a) Simple API uses its own decode path (no Schema wrapping) — duplicate logic but simpler types
  - (b) Wrap each sync decoder as a Schema via `Schema.transform(Schema.Unknown, TargetSchema, { decode: fn })` — reuses pickAllFrom

Chose (a) — simpler, avoids Schema wrapping gymnastics. The simple path validates transformed values with each Standard Schema directly.

#### 5. Re-exports (src/effect.ts, src/index.ts)

- Remove `Step` from public Effect API exports (or keep as deprecated/internal)
- Remove `pickFrom`, `pickAllFrom` from public exports (internal to runner now)
- Remove `pick`, `pickAll` from simple exports
- Keep ITF type schemas/decoders as public (users need them for `picks` declarations)

#### 6. Vitest helper (src/vitest.ts)

- Signature follows from `SimpleRunOptions` / `QuintRunOptions` changes — mechanical update

#### 7. Tests

- Rewrite `test/integration.test.ts` — counter driver becomes `actions: { Increment: { picks: Schema.Struct({ amount: ITFBigInt }), handler } }`
- Keep vitest helper tests compiling against the updated option types
- Add test: unknown action from spec not in `actions` map → `TraceReplayError`
- Add test: type inference — verify picks parameter type matches schema declaration (compile-time check)

#### 8. README

- Rewrite usage examples for both APIs
- Remove `pick()`/`pickAll()` documentation
- Show the `actions` pattern as primary

#### 9. Changeset

- `npx changeset` — major bump (breaking: Driver interface replaced)

### Open Questions

1. Per-trace state isolation: resolved by keeping factory pattern (a).
2. Unknown actions (action in trace but not in `actions` map): resolved as `TraceReplayError`, with existing init/no-op conveniences preserved.
3. Raw step access: resolved as a clean break in the public driver shape.
4. The `nondetPath` (Choreo) codepath feeds into the same action-map dispatch path.
