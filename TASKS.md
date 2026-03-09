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
  actions: {
    Increment: {
      picks: Schema.Struct({ amount: ITFBigInt }),
      handler: ({ amount }) => Effect.sync(() => { count += amount }),
    },
  },
  getState: () => Effect.succeed({ count }),
  stateCheck: { ... },
})
```

Simple:
```ts
run({
  spec: "./counter.qnt",
  actions: {
    Increment: {
      picks: { amount: decodeBigInt },
      handler: ({ amount }) => { count += amount },
    },
  },
  getState: () => ({ count }),
  stateCheck: { ... },
})
```

### Plan

#### 1. Types (src/driver/types.ts)

- Define `ActionDef<Picks, E, R>` — `{ picks: Schema.Struct<...>, handler: (picks: Picks) => Effect<void, E, R> }`
- Define `ActionMap<E, R>` — `Record<string, ActionDef<any, E, R>>` with inference helper
- Keep `Config` (statePath, nondetPath) unchanged
- Keep `Step` as internal type (runner still constructs it) but remove from public API
- Remove `Driver.step()` — replaced by action map
- `getState` and `config` move up to run options or stay as top-level fields alongside `actions`
- Remove `DriverFactory` — `actions` is stateless dispatch; mutable state lives in closure (same as today's pattern but without the factory indirection)

Open question: do we still need `DriverFactory.create()` per-trace isolation? Today each trace gets a fresh driver. With `actions`, the closure state must reset per trace. Options:
  - (a) Keep a factory: `createDriver: () => { actions, getState, config }` — simplest, matches current pattern
  - (b) Add explicit `reset()` callback
  - (c) `actions` in options + `createState: () => S` factory for per-trace state

Leaning (a) — least change, users already understand the factory pattern.

#### 2. Simple API types (src/simple.ts)

- `SyncActionDef<Picks>` — `{ picks: Record<string, (raw: unknown) => unknown>, handler: (picks: Picks) => void | Promise<void> }`
- Mapped type: infer `Picks` from `picks` field — `{ [K in keyof P]: ReturnType<P[K]> }`
- `SimpleRunOptions` gets `createDriver: () => { actions: { [name]: SyncActionDef }, getState?, config? }`
- Remove public `pick()`, `pickAll()` — they become internal or removed entirely
- Keep `decodeBigInt`, `decodeSet`, etc. as public sync decoders (used in `picks` field)

#### 3. Runner dispatch (src/runner/runner.ts)

- After extracting `action` + `nondetPicks` from MBT metadata (unchanged)
- Look up `actions[action]` — fail with `TraceReplayError` if action not in map (unknown action from spec)
- Call `pickAllFrom(step, actionDef.picks)` to decode picks
- Call `actionDef.handler(decodedPicks)`
- State check logic unchanged

Roughly:
```ts
const actionDef = driver.actions[action]
if (!actionDef) return yield* new TraceReplayError({ message: `Unknown action: ${action}`, ... })
const picks = yield* pickAllFrom(step, actionDef.picks)
yield* actionDef.handler(picks)
```

#### 4. Wrapper in simple.ts

- `wrapDriver` adapts simple actions to Effect actions:
  - For each action: wrap sync `picks` decoders into `Schema.Struct` fields via `Schema.transform`
  - Wrap sync/async handler into `Effect.promise`

Key type challenge: bridging `{ amount: decodeBigInt }` (sync codec record) to `Schema.Struct({ amount: SomeSchema })`. Two approaches:
  - (a) Simple API uses its own decode path (no Schema wrapping) — duplicate logic but simpler types
  - (b) Wrap each sync decoder as a Schema via `Schema.transform(Schema.Unknown, TargetSchema, { decode: fn })` — reuses pickAllFrom

Leaning (a) — simpler, avoids Schema wrapping gymnastics. The simple path just does `Object.fromEntries(map(([k, v]) => [k, decoder(unwrapOption(raw))]))` directly.

#### 5. Re-exports (src/effect.ts, src/index.ts)

- Remove `Step` from public Effect API exports (or keep as deprecated/internal)
- Remove `pickFrom`, `pickAllFrom` from public exports (internal to runner now)
- Remove `pick`, `pickAll` from simple exports
- Keep ITF type schemas/decoders as public (users need them for `picks` declarations)

#### 6. Vitest helper (src/vitest.ts)

- Signature follows from `SimpleRunOptions` / `QuintRunOptions` changes — mechanical update

#### 7. Tests

- Rewrite `test/integration.test.ts` — counter driver becomes `actions: { Increment: { picks: Schema.Struct({ amount: ITFBigInt }), handler } }`
- Rewrite `test/vitest-helper.test.ts`
- `test/itf-picks.test.ts` — keep for internal `pickAllFrom` unit tests
- Add test: unknown action from spec not in `actions` map → `TraceReplayError`
- Add test: type inference — verify picks parameter type matches schema declaration (compile-time check)

#### 8. README

- Rewrite usage examples for both APIs
- Remove `pick()`/`pickAll()` documentation
- Show the `actions` pattern as primary

#### 9. Changeset

- `npx changeset` — major bump (breaking: Driver interface replaced)

### Open Questions

1. Per-trace state isolation: factory pattern (a) vs reset callback (b) vs state factory (c)?
2. Should unknown actions (action in trace but not in `actions` map) error or silently skip? Error is safer.
3. Should we keep `pick`/`pickFrom` as escape hatches for advanced use (raw Step access)? Or clean break?
4. The `nondetPath` (Choreo) codepath also needs to feed into the same dispatch — verify it produces compatible action+picks shape.
