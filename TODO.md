# TODO

## v1 (quint run only)

- [x] Project scaffold with Effect TS, eslint, vitest, husky harness
- [x] ITF schema (effect/Schema) — BigInt, Set, Tuple, Map, MBT metadata
- [x] Driver interface — Step, Config, DriverFactory, StateComparator
- [x] CLI spawning — npx @informalsystems/quint run --mbt --backend typescript
- [x] Runner — trace generation, replay, state comparison, error reporting
- [x] Tests — unit tests for ITF parsing, integration test with a real .qnt spec
- [x] Nondet pick helpers — unwrap Quint Option variant encoding (Some/None) for common types
- [ ] Seed propagation — blocked: quint doesn't embed auto-generated seed in ITF #meta or stderr
- [x] Verbosity control — QUINT_VERBOSE env var passthrough
- [x] README with usage example

## README improvements

- [ ] Key Features section — validate each claim before adding:
  - [ ] "Automatic Trace Generation": spawns `quint run --mbt`, parses ITF traces
  - [ ] "State Validation": compares impl state against spec state after every step
  - [ ] "Stateless Mode": omit state checking for smoke-testing
  - [ ] "Concurrent Replay": replay multiple traces in parallel
  - [ ] "Dual API": simple promise-based + full Effect API
  - [ ] "Reproducible Failures": seeds auto-generated and reported, replayable via `QUINT_SEED`
  - [ ] "Choreo Support": custom `nondetPath` config for sum-type action encoding
- [ ] Tips and Tricks section (anonymous actions, Option/enum handling, etc.) — test each tip before documenting
- [ ] Examples directory with runnable examples
- [ ] Verbosity/reproducibility documentation (`QUINT_VERBOSE`, `QUINT_SEED` workflow)
- [ ] Overview paragraph explaining what MBT is and why you'd use it

## Post-v1

- [ ] `quint test` support — blocked on quint issue #1842 (--mbt flag for quint test)
- [x] Backend choice — add `--backend rust` option (faster but requires quint rust evaluator binary)
- [x] Opt-in state comparison — allow drivers to skip state validation
- [x] Concurrent trace replay — parallelize via Effect fiber concurrency (`concurrency` option on `QuintRunOptions` / `SimpleRunOptions`)
- [ ] Typed action dispatch — declarative per-action schema + handler map, eliminating untyped `switch`/`pick()`:
  - Existing infra: `pickAllFrom(step, Schema.Struct)` already decodes all picks per action (src/itf/picks.ts)
  - Existing infra: `ItfOption`, `ITFBigInt`, etc. handle ITF type decoding (via @firfi/itf-trace-parser)
  - Missing: dispatch layer that maps action name → schema + handler with full type inference
  - Init action: no handler needed — runner already skips step 0 (runner.ts:98)
  - Breaking change to `Driver`/`SimpleDriver` — replace untyped `step(Step)` with typed action map
  - Codegen from .qnt deferred — quint has no stable AST export API for external tools
  - Target API (simple):
    ```ts
    const result = await run({
      spec: "./counter.qnt",
      actions: {
        Increment: {
          picks: { amount: decodeBigInt },
          handler: (state, { amount }) => { state.count += amount },  // amount: bigint, typed
        },
      },
      // ...
    })
    ```
  - Target API (Effect):
    ```ts
    const result = yield* quintRun({
      spec: "./counter.qnt",
      actions: {
        Increment: {
          picks: Schema.Struct({ amount: ITFBigInt }),
          handler: (state, { amount }) => Effect.succeed(state.count += amount),
        },
      },
      // ...
    })
    ```
- [x] Vitest integration — optional helper generating `test()` calls from traces
- [x] Trace persistence — `--trace-dir` option to keep ITF files for debugging
- [x] Invariant checking — pass `--invariant` to quint run
- [x] Witness reporting — pass `--witness` to quint run
- [x] CI example — GitHub Actions workflow for MBT
- [x] ADR-015 full compliance — verify all ITF value types are handled (variants, unserializable)

