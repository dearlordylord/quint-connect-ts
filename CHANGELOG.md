# @firfi/quint-connect

## 1.0.0

### Major Changes

- 7883c17: Replace Step-based driver interface with schema-based action dispatch via `defineDriver`.

  **Simple API:** `defineDriver(schema, factory)` — per-field Standard Schema picks (Zod, Valibot, ArkType). `defineDriver(factory)` — raw mode with `step` callback. `pickFrom(nondetPicks, key, schema)` for extracting typed picks in raw mode.

  **Effect API:** `defineDriver(schema, factory)` — per-field Effect Schema picks, returns `DriverFactory` directly.

  Both APIs provide compile-time enforced handler coverage and inferred pick types.

  **Breaking changes:**

  - Removed `pick()`, `pickAll()`, `decodeBigInt`, `decodeSet`, `decodeMap`, `decodeTuple`, `decodeList`, `decodeUnserializable` from simple API
  - Removed `pickFrom(step, key, schema)`, `pickAllFrom(step, struct)` from Effect API (replaced by action dispatch)
  - Removed `Step` type export from both entry points
  - `Driver` interface changed: `step(Step)` → `actions` map + optional `step(action, picks)`
  - `SimpleRunOptions.createDriver` → `SimpleRunOptions.driver`
  - `@standard-schema/spec` is now a dependency

## 0.2.2

### Patch Changes

- fbda75c: Add npm keywords: property-based-testing, state-machine

## 0.2.1

### Patch Changes

- Stop forcing `--backend typescript` by default — inherit quint CLI default (`rust`). This avoids a Quint bug where `--backend typescript` corrupts `mbt::actionTaken` for non-disjunctive step actions (all states show `"init"` instead of the actual action name).
- Add `statePath` integration test with nested state spec (`routingState` record variable).
- Document deterministic spec config (`nTraces: 1, maxSamples: 1`), `statePath` semantics, backend known issues, and missing RunOptions fields in README.
- Add `BUG_REPORT.md` with full root cause analysis and fix for the Quint TypeScript backend bug.

## 0.2.0

### Minor Changes

- Add 10 new features completing all non-blocked TODO items:

  - **Backend choice**: `backend` option (`"typescript" | "rust"`) on RunOptions
  - **Verbosity control**: `verbose` option passes QUINT_VERBOSE env var to quint subprocess
  - **Opt-in state comparison**: `getState` is now optional on Driver/SimpleDriver when stateCheck is omitted
  - **Concurrent trace replay**: `concurrency` option on QuintRunOptions/SimpleRunOptions for parallel trace replay via Effect fibers
  - **Typed nondet picks**: `pickAllFrom` (Effect) and `pickAll` (sync) for Schema-based batch pick extraction with auto ItfOption unwrapping
  - **Vitest integration**: new `@firfi/quint-connect/vitest` entry point with `quintTest` and `quintIt` helpers
  - **Trace persistence**: `traceDir` option to keep ITF files instead of auto-cleanup
  - **Invariant checking**: `invariants` option passes `--invariant` flags to quint run
  - **Witness reporting**: `witnesses` option passes `--witness` flags to quint run
  - **ADR-015 full compliance**: added `decodeTuple`, `decodeList`, `decodeUnserializable` sync decoders
  - **CI example**: GitHub Actions workflow template at `.github/workflows/mbt.yml`

## 0.1.2

### Patch Changes

- c90425d: Fix stdout pipe buffer deadlock when quint produces large output (e.g. many traces)
