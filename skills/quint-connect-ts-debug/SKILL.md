---
name: quint-connect-ts-debug
description: >
  Diagnose quint-connect test failures. StateMismatchError (state diverged
  at step N, has traceIndex, stepIndex, expected, actual),
  TraceReplayError (handler threw, has action, cause), NoTracesError
  (wrong --main module or unsatisfiable spec), QuintError (quint run
  exited non-zero), QuintNotFoundError (quint CLI not on PATH).
  Reproduce failures deterministically with seed. Inspect raw ITF traces
  via traceDir. Use when a quint-connect test fails and you need to
  understand why.
type: core
library: quint-connect-ts
library_version: "0.6.0 (Effect 3, @latest) / 1.0.0-effect4 (Effect 4, @effect4)"
sources:
  - "dearlordylord/quint-connect-ts:README.md"
  - "dearlordylord/quint-connect-ts:src/runner/runner.ts"
  - "dearlordylord/quint-connect-ts:src/cli/quint.ts"
  - "dearlordylord/quint-connect-ts:BUG_REPORT.md"
---

# quint-connect-ts -- Debug Failing Trace

## Effect 3 vs Effect 4

This only matters if the project uses `effect` as a dependency (Effect API path). The Simple API error handling is identical across both versions. Install the correct dist-tag: `@firfi/quint-connect@latest` for `effect@^3`, `@firfi/quint-connect@effect4` for `effect@^4`. See `quint-connect-ts-setup` skill for full details and API difference table.

The error classes (`StateMismatchError`, `TraceReplayError`, etc.) work the same way in both versions. Internally they use `Schema.TaggedError` (Effect 3) or `Schema.TaggedErrorClass` (Effect 4), but the user-facing API (`Effect.catchTag`, error fields) is unchanged.

## Error Types

| Error | When | Key fields |
|---|---|---|
| `StateMismatchError` | `compareState` returned false | `traceIndex`, `stepIndex`, `expected`, `actual` |
| `TraceReplayError` | Handler threw, decode failed, unknown action | `traceIndex`, `stepIndex`, `action`, `cause` |
| `NoTracesError` | `quint run --mbt` produced no trace files | -- |
| `QuintError` | `quint run` exited non-zero | stderr output |
| `QuintNotFoundError` | `quint` CLI not found on PATH | -- |

## Setup -- Error Handling (Simple API)

```ts
import {
  run,
  StateMismatchError,
  TraceReplayError,
} from "@firfi/quint-connect"

try {
  await run(opts)
} catch (e) {
  if (e instanceof StateMismatchError) {
    console.log("State diverged at trace", e.traceIndex, "step", e.stepIndex)
    console.log("Expected (spec):", e.expected)
    console.log("Actual (impl):", e.actual)
  }
  if (e instanceof TraceReplayError) {
    console.log("Action failed:", e.action, "at step", e.stepIndex)
    console.log("Cause:", e.cause)
  }
}
```

## Setup -- Error Handling (Effect API)

```ts
import { quintRun } from "@firfi/quint-connect/effect"

quintRun(opts).pipe(
  Effect.catchTag("StateMismatchError", (e) =>
    Effect.log("Diverged at", e.traceIndex, e.stepIndex, e.expected, e.actual)),
  Effect.catchTag("TraceReplayError", (e) =>
    Effect.log("Action", e.action, "failed:", e.cause)),
)
```

## Core Patterns

### Reproduce a failure with seed

Every `run`/`quintRun` result includes a `seed`. Pass it back to get the exact same traces:

```ts
// First run — failure reported
const result = await run({
  spec: specPath,
  driver: myDriver,
  nTraces: 10,
})
// result.seed = "0x138ff8c9"

// Reproduce — same traces, same failure
const result2 = await run({
  spec: specPath,
  driver: myDriver,
  nTraces: 10,
  seed: "0x138ff8c9",
})
```

The seed can also be set via `QUINT_SEED` environment variable.

### Inspect raw ITF traces

Use `traceDir` to persist trace files for manual inspection:

```ts
await run({
  spec: specPath,
  driver: myDriver,
  traceDir: "./debug-traces",
})
```

Then read the JSON files in `./debug-traces/` to see the raw ITF state at each step. Look for:
- `mbt::actionTaken` — which action was dispatched
- `mbt::nondetPicks` — what nondeterministic values were chosen
- State variable keys — verify fully-qualified names

### Run quint manually to inspect output

Before writing any driver code, run quint directly to see what it produces:

```bash
npx @informalsystems/quint run --mbt \
  --max-samples 1 --max-steps 3 \
  specs/counter.qnt
```

This shows the exact ITF output: variable names, ITF encoding, action names. Inspect this before guessing at schema shapes.

### Debug NoTracesError

`NoTracesError` means quint ran but produced zero trace files. Common causes:

1. **Wrong module name** — multi-module specs require `--main`:
   ```ts
   await run({ spec: specPath, main: "counter_test" })
   ```
2. **Unsatisfiable spec** — the init or step action's preconditions are never satisfied. Check the spec logic.
3. **Wrong spec path** — the file doesn't exist or isn't a valid `.qnt` file.

### Debug QuintNotFoundError

Quint CLI must be on PATH. Install it:

```bash
pnpm add -D @informalsystems/quint
```

Or ensure it's available globally. `npx @informalsystems/quint` works without global install.

## Common Mistakes

### CRITICAL Return live mutable object from getState

Wrong:

```ts
const state = { items: new Map() }
return {
  getState: () => state,
}
```

Correct:

```ts
const state = { items: new Map() }
return {
  getState: () => ({ items: new Map(state.items) }),
}
```

The runner captures state after each step for comparison. Returning a live reference means the captured "expected" snapshot mutates when the next step runs. All comparisons pass vacuously.

Source: maintainer interview

### HIGH Re-run without seed to reproduce failure

Wrong:

```ts
// Test failed, try again:
await run({ spec: specPath, nTraces: 10 })
// Different random traces, different failure — or no failure at all
```

Correct:

```ts
// Use the seed from the failed run's output:
await run({ spec: specPath, nTraces: 10, seed: "0x138ff8c9" })
// Exact same traces, exact same failure
```

Without a seed, `quintRun` generates new random traces each time. The original failure may not reproduce. Always capture and reuse the seed.

Source: README.md

### HIGH Hack the comparator instead of fixing the implementation

Wrong:

```ts
stateCheck(deserialize, (spec, impl) => {
  const { internalField: _, ...specRest } = spec
  const { internalField: __, ...implRest } = impl
  return deepEqual(specRest, implRest)
})
```

Correct:

```ts
stateCheck(deserialize, (spec, impl) =>
  spec.count === impl.count && spec.flag === impl.flag
)
```

When state diverges, the Quint spec is the source of truth. Ignoring fields, sorting maps, or adding exceptions to the comparator masks real implementation bugs. Fix the TS code to match the spec.

Source: maintainer interview

### MEDIUM Use nTraces: 1 in CI for speed

Wrong:

```ts
await run({ spec: specPath, nTraces: 1, maxSteps: 50 })
```

Correct:

```ts
await run({ spec: specPath, nTraces: 10, maxSteps: 50 })
```

A single trace covers one random execution path. Bugs on other paths pass CI and merge. 10 traces with 50 steps covers diverse paths without being excessively slow.

Source: maintainer interview

### MEDIUM Hardcode relative spec path

Wrong:

```ts
await run({ spec: "../../specs/counter.qnt" })
```

Correct:

```ts
import * as path from "node:path"
const specPath = path.join(import.meta.dirname, "specs", "counter.qnt")
await run({ spec: specPath })
```

Relative paths like `../../specs/counter.qnt` depend on the working directory. They work locally but break in CI where the test runner may use a different cwd.

Source: examples/counter/counter.test.ts

### MEDIUM Use Effect.orDie in production state deserializer

Wrong:

```ts
stateCheck(
  (raw) => Schema.decodeUnknown(MyState)(raw).pipe(Effect.orDie),
  (spec, impl) => spec.count === impl.count,
)
```

Correct:

```ts
stateCheck(
  (raw) => Schema.decodeUnknown(MyState)(raw),
  (spec, impl) => spec.count === impl.count,
)
```

`Effect.orDie` converts decode failures to untyped defects. This loses the structured `TraceReplayError` context (traceIndex, stepIndex, action) that helps diagnosis. Fine for prototyping; in CI, let errors propagate with full context.

Source: maintainer interview

### HIGH Tension: setup simplicity vs production robustness

Patterns that work during prototyping (`Effect.orDie`, `nTraces: 1`, partial state comparison) silently mask bugs in production. When optimizing for quick setup, agents omit the robustness that makes MBT testing valuable. Use `nTraces: 10+`, compare all state fields, and preserve structured error context.

See also: quint-connect-ts-setup/SKILL.md

See also: quint-connect-ts-itf-decoding/SKILL.md -- decode errors often surface as TraceReplayError
