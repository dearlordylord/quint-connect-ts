# @firfi/quint-connect — Design Specification

## Why

[quint-connect](https://github.com/informalsystems/quint-connect) exists only for Rust. No TypeScript equivalent exists — no npm package, no GitHub issues requesting one, no plans from Informal Systems. The Quint team positions MBT as language-agnostic (generate ITF traces, write driver in any language), but only automates the Rust side. We're the first TS implementation.

Quint itself is written in TypeScript. The `@informalsystems/quint` npm package ships `itf.ts` internally but does not re-export ITF types from its public API (`index.ts`). Importing from internal paths (`dist/src/itf`) would be brittle. We own our ITF schemas.

## What quint-connect does

Model-based testing framework that:
1. Spawns `quint run` CLI as a subprocess with `--mbt` flag
2. Captures ITF (Intermediate Trace Format) JSON output written to temp files
3. Replays traces through a user-implemented Driver — calling `driver.step(step)` for each action
4. After each step, compares spec state (deserialized from ITF) against implementation state (extracted from driver)
5. Reports mismatches with trace/step/action context

## Architecture (Rust version)

| Component | Purpose |
|---|---|
| `Driver` trait | User implements: `step(&mut self, step: &Step)` + `type State` |
| `State` trait | `from_driver(driver)` + `from_spec(value)` + `PartialEq` for comparison |
| `Step` struct | `action_taken: String`, `nondet_picks`, `state: Value` |
| `Config` | `state: Path` and `nondet: Path` for locating state in spec |
| `generator` | Spawns `quint run/test`, writes ITF to tmpdir, parses JSON |
| `runner` | Iterates traces, calls driver, diffs states |
| `switch!` macro | Pattern-match on action name, extract nondet picks |
| `#[quint_run]` / `#[quint_test]` | Proc macros generating test functions with CLI config |

## Decisions

### Backend: `--backend typescript` (default)

Zero extra dependencies. The Rust backend is faster but requires the quint Rust evaluator binary. Backend choice added to TODO for post-v1.

### No proc macros needed

TS has no compile-time metaprogramming. Replaced with a builder API: `quintRun({ spec, driverFactory, ... })`. Plain `switch`/`if-else` for action dispatch. Users can use `absurd()` pattern for exhaustive matching on discriminated unions if desired.

### Effect TS

Used for:
- **Resource management**: temp directories via `Effect.scoped` + `fs.makeTempDirectoryScoped()`
- **Error handling**: `Schema.TaggedError` for all error types (`QuintError`, `StateMismatchError`, etc.)
- **ITF parsing**: `effect/Schema` for runtime-validated deserialization of ITF JSON
- **Subprocess management**: `@effect/platform` Command API
- **Type safety**: No `as` casts at system boundaries

### ITF schemas: own definitions, not importing from quint

The ITF format is stable (specified in [Apalache ADR-015](https://apalache-mc.org/docs/adr/015adr-trace.html)). Special type encodings:
- `{ "#bigint": "42" }` → `bigint`
- `{ "#set": [1, 2, 3] }` → `Set`
- `{ "#map": [["a", 1]] }` → `Map`
- `{ "#tup": [1, 2] }` → tuple (post-v1)
- `{ "#unserializable": "..." }` → opaque

### State comparison: full, after every step (Rust feature parity)

Users must implement `getState()` and provide `compareState` and `deserializeState`. Opt-in skip is TODO.

### Framework-agnostic

`quintRun()` returns an Effect that either succeeds with `{ tracesReplayed }` or fails with a tagged error. Works with any test runner — vitest, jest, node:test, or direct `Effect.runPromise`.

### Async driver step

`Driver.step()` returns `Effect<void, E, R>`. Sync drivers just return `Effect.void`.

### Nondet picks API (v1): untyped accessor

`step.nondetPicks` is a `ReadonlyMap<string, unknown>`. Users extract picks by key with runtime type checking. Typed per-action schemas are TODO.

### Temp directory: Effect-managed, auto-cleanup

`fs.makeTempDirectoryScoped()` creates a temp dir. `Effect.scoped` ensures cleanup. Feature parity with Rust's `TempDir` RAII.

### `quint run` only (v1)

`quint test --mbt` is not supported yet (quint issue [#1842](https://github.com/informalsystems/quint/issues/1842)). v1 covers `quint run` only.

### CLI invocation: `npx @informalsystems/quint`

Works out of the box. Quint is expected to be available via npx. Key flags passed:
- `--mbt` — adds `mbt::actionTaken` and `mbt::nondetPicks` metadata to each state
- `--out-itf` — writes ITF JSON files with `{seq}` placeholder
- `--backend typescript` — uses the TS evaluator (zero extra deps)
- `--seed` — reproducibility
- `--n-traces`, `--max-steps`, `--max-samples` — simulation parameters

### Single package, not monorepo

Following `@firfi/huly-mcp` pattern. Published as `@firfi/quint-connect` on npm.

### Harness copied from hulymcp

- ESLint flat config with `@effect/eslint-plugin` (dprint formatting)
- `eslint-plugin-functional` (with Effect-compatible overrides)
- `import-x/no-unused-modules` for dead export detection
- TypeScript strict mode + `exactOptionalPropertyTypes`
- `@effect/language-service` TS plugin
- Vitest with 99% coverage thresholds
- Husky pre-commit: lint-staged + gitleaks
- madge (circular deps) + jscpd (code duplication)

## ITF trace structure (with --mbt)

Each state in the trace looks like:
```json
{
  "#meta": { "index": 1 },
  "mbt::actionTaken": "Transfer",
  "mbt::nondetPicks": {
    "sender": { "#bigint": "2" },
    "receiver": { "#bigint": "0" },
    "amount": { "#bigint": "42" }
  },
  "balance": { "#map": [
    [{ "#bigint": "0" }, { "#bigint": "58" }],
    [{ "#bigint": "1" }, { "#bigint": "100" }],
    [{ "#bigint": "2" }, { "#bigint": "42" }]
  ]}
}
```

## User-facing API sketch

```ts
import { quintRun } from "@firfi/quint-connect"
import { Effect, Schema } from "effect"
import { NodeContext } from "@effect/platform-node"

const driverFactory = {
  create: () => Effect.succeed({
    state: { balance: new Map<bigint, bigint>() },
    step: (step) => Effect.gen(function*() {
      switch (step.action) {
        case "Transfer": { /* ... */ break }
        case "Deposit": { /* ... */ break }
        default: break // or absurd(step.action) for exhaustive check
      }
    }),
    getState: () => Effect.succeed(/* ... */),
  })
}

const program = quintRun({
  spec: "./specs/bank.qnt",
  nTraces: 100,
  maxSteps: 20,
  driverFactory,
  compareState: (a, b) => /* deep equal */,
  deserializeState: (raw) => Schema.decodeUnknown(MyStateSchema)(raw),
})

// In vitest:
test("bank spec", () =>
  Effect.runPromise(program.pipe(Effect.provide(NodeContext.layer)))
)
```

## Open questions

1. **Nondet picks typed API**: Should we support per-action Schema-based extraction? e.g. `driver.on("Transfer", TransferPicksSchema, handler)`. Deferred to post-v1.
2. **Trace persistence**: Should we add `--trace-dir` to keep ITF files for debugging? Deferred.
3. **Invariant/witness passthrough**: Forward `--invariants` and `--witnesses` to quint run? Deferred.
