# @firfi/quint-connect

## 1.0.0-effect4.2

### Minor Changes

- Remove onInit hook, dispatch step 0 as regular action (Rust quint-connect parity). BREAKING: `onInit` removed from Driver, defineDriver, and SimpleDriver.

## 1.0.0-effect4.1

### Patch Changes

- 5953c01: add init method

## 1.0.0-effect4.0

### Major Changes

- ee05414: Migrate to Effect 4 beta. Upgrade effect, @effect/platform-node, and @effect/vitest to ^4.0.0-beta.31. Remove @effect/platform (merged into effect core). Add local Effect 4 compatible ITF schemas.

## 0.4.2

### Patch Changes

- ### Bug fixes

  - Handler throws in Simple API now wrapped in `TraceReplayError` with trace/step context (previously propagated as raw errors without `instanceof` support)

  ### Documentation

  - Document seed format requirement (must be big integer: decimal or hex)
  - Document `TraceReplayError` properties (`traceIndex`, `stepIndex`, `action`, `cause`)
  - Clarify `statePath` + `getState` interaction
  - Note Zod 4+ requirement in install instructions
  - Fix `driver` type in RunOptions table

## 0.4.1

### Patch Changes

- ### Bug fixes

  - Fix runtime crash when `config()` returns partial Config (e.g. only `statePath` without `nondetPath`)
  - QuintError message now includes quint's stderr output for better debugging

  ### Documentation

  - Document vitest helper import paths (`@firfi/quint-connect/vitest-simple`, `@firfi/quint-connect/vitest`)
  - Document error handling: exported error types, `instanceof` (Simple API), `catchTag` (Effect API)
  - Document additional exports across all entry points
  - Add Quint CLI prerequisite to requirements

## 0.4.0

### Minor Changes

- ### Bug fixes

  - Fix `instanceof` for `TraceReplayError` / `StateMismatchError` — errors are now thrown directly instead of wrapped by Effect
  - Strip `#meta` and `mbt::*` metadata keys from state before comparison
  - StateMismatchError includes expected/actual JSON in message
  - Init action error hints at known Quint TypeScript backend bug
  - Fix stale dist and tsbuildinfo in published package

  ### New features

  - New `@firfi/quint-connect/zod` entry point — re-exports `ITFBigInt`, `ITFSet`, `ITFMap`, `TraceCodec` from `@firfi/itf-trace-parser/zod`
  - New `@firfi/quint-connect/vitest-simple` entry point — `quintTest` helper without `@effect/vitest` dependency
  - `quintTest` and `quintIt` now return the run result
  - `effect`, `@effect/platform-node`, `zod`, `@effect/vitest` declared as optional peer dependencies

## 0.3.2

### Patch Changes

- Fix published package missing dist/ (0.3.0 and 0.3.1 were broken)
- Add dist/ existence check to prepublishOnly

## 0.3.1

### Patch Changes

- Fix stale dist artifacts in published package; clean dist before build

## 0.3.0

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
