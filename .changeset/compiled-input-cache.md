---
"@firfi/quint-connect": minor
---

Add `compiledInput` option for cached spec evaluation

New `compiledInput` field on `RunOptions` accepts a path to a pre-compiled evaluator input JSON file. When provided and the file exists, `quint run`'s 15s+ parse/typecheck is skipped entirely — the compiled input is fed directly to the Rust evaluator via stdin pipe.

Other changes:
- Try `quint` directly before falling back to `npx @informalsystems/quint` (~3s faster when globally installed, logs warning on fallback)
- Kill entire process group on cancellation (`detached: true` + `SIGKILL` to process group) to prevent zombie `quint_evaluator` processes
- `QUINT_EVALUATOR_VERSION` env var to pin a specific evaluator version
- `#bigint` ITF encoding for trace output compatibility with `@firfi/itf-trace-parser`
