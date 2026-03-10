---
"@firfi/quint-connect": major
---

Replace Step-based driver interface with schema-based action dispatch via `defineDriver`.

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
