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
- [ ] Verbosity control — QUINT_VERBOSE env var passthrough
- [x] README with usage example

## Post-v1

- [ ] `quint test` support — blocked on quint issue #1842 (--mbt flag for quint test)
- [ ] Backend choice — add `--backend rust` option (faster but requires quint rust evaluator binary)
- [ ] Opt-in state comparison — allow drivers to skip state validation
- [ ] Worker threads — parallelize trace replay for large trace sets
- [x] Typed nondet picks — effect/Schema-based per-action pick extraction:
  ```ts
  const TransferPicks = Schema.Struct({
    sender: ItfBigInt,
    receiver: ItfBigInt,
    amount: ItfBigInt,
  })
  driver.on("Transfer", TransferPicks, async (picks) => { ... })
  ```
- [ ] Vitest integration — optional helper generating `test()` calls from traces
- [ ] Trace persistence — `--trace-dir` option to keep ITF files for debugging
- [ ] Invariant checking — pass `--invariants` to quint run
- [ ] Witness reporting — pass `--witnesses` to quint run
- [ ] CI example — GitHub Actions workflow for MBT
- [ ] ADR-015 full compliance — verify all ITF value types are handled (variants, unserializable)
