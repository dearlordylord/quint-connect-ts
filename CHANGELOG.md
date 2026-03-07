# @firfi/quint-connect

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
