---
name: quint-connect-ts-itf-decoding
description: >
  Decode Quint ITF JSON encoding to native JS types for quint-connect drivers
  and state checks. ITFBigInt for {"#bigint":"N"} to bigint, ITFSet for
  {"#set":[...]} to Set, ITFMap for {"#map":[[k,v],...]} to Map, ITFTuple,
  ITFVariant, ItfOption for Quint Option (Some/None to T | undefined).
  Fully-qualified state variable names ("testmod::specmod::var"). Zod
  (@firfi/quint-connect/zod) and Effect Schema (@firfi/quint-connect/effect)
  variants. transformITFValue. Structural deep comparison for Maps and Sets.
  Use when writing ITF decoders, debugging decode errors, or comparing
  complex state.
type: core
library: quint-connect-ts
library_version: "0.6.0 (Effect 3, @latest) / 1.0.0-effect4 (Effect 4, @effect4)"
sources:
  - "dearlordylord/quint-connect-ts:README.md"
  - "dearlordylord/quint-connect-ts:src/itf/schema.ts"
  - "dearlordylord/quint-connect-ts:src/zod.ts"
  - "dearlordylord/quint-connect-ts:test/itf-schema.test.ts"
  - "dearlordylord/quint-connect-ts:test/itf-picks.test.ts"
---

# quint-connect-ts -- ITF Type Decoding

Quint outputs state and picks in ITF (Informal Trace Format) JSON encoding. Each Quint type has a specific JSON representation that must be decoded to native JS types before use.

## ITF Type Mapping

| Quint type | ITF JSON | JS type | Schema (Effect) | Schema (Zod) |
|---|---|---|---|---|
| `int` | `{"#bigint":"42"}` | `bigint` | `ITFBigInt` | `ITFBigInt` |
| `str` | `"hello"` | `string` | `Schema.String` | `z.string()` |
| `bool` | `true` | `boolean` | `Schema.Boolean` | `z.boolean()` |
| `Set(T)` | `{"#set":[...]}` | `Set<T>` | `ITFSet(inner)` | `ITFSet(inner)` |
| `T -> U` (Map) | `{"#map":[[k,v],...]}` | `Map<K,V>` | `ITFMap(k, v)` | `ITFMap(k, v)` |
| `(T1, T2)` (Tuple) | `{"#tup":[...]}` | `[T1, T2]` | `ITFTuple(...)` | `z.tuple([...])` |
| `{ f: T }` (Record) | `{"f": ...}` | `{ f: T }` | `Schema.Struct({...})` | `z.object({...})` |
| `Option(T)` | `{tag:"Some",value:...}` / `{tag:"None",...}` | `T \| undefined` | `ItfOption(inner)` | -- |

All Quint `int` values become `bigint`, never `number`. Use `0n` literals.

## Effect 3 vs Effect 4

This only matters if the project uses `effect` as a dependency. The Zod / Simple API is identical across both versions. Install the correct dist-tag: `@firfi/quint-connect@latest` for `effect@^3`, `@firfi/quint-connect@effect4` for `effect@^4`. See `quint-connect-ts-setup` skill for full details and API difference table.

The Effect Schema examples below use Effect 3 syntax. For Effect 4, the ITF schema imports (`ITFBigInt`, `ITFSet`, `ITFMap`, `ItfOption`) are the same — only the underlying Effect/Schema API calls differ (see setup skill).

## Setup -- Effect Schema

```ts
import { ITFBigInt, ITFSet, ITFMap, ItfOption } from "@firfi/quint-connect/effect"
import { Schema } from "effect"

const CacheState = Schema.Struct({
  data: ITFMap(Schema.String, ITFBigInt),
  keys: ITFSet(Schema.String),
  limit: ITFBigInt,
  pending: ItfOption(Schema.String),
})
```

## Setup -- Zod

```ts
import { ITFBigInt, ITFSet, ITFMap } from "@firfi/quint-connect/zod"
import { z } from "zod"

const CacheState = z.object({
  data: ITFMap(z.string(), z.bigint()),
  keys: ITFSet(z.string()),
  limit: z.bigint(),
})
```

ITF values (`{"#bigint":"5"}`) are automatically transformed to native types (`5n`) by `transformITFValue` before schema validation. For Zod state schemas, use `z.bigint()` (not `ITFBigInt`) because the transformation already happened. For picks in `defineDriver`, use `ITFBigInt` from `@firfi/quint-connect/zod`.

## Core Patterns

### Compose schemas for nested Quint types

Quint: `Set(int) -> int` (a map from sets of ints to ints):

```ts
import { ITFBigInt, ITFSet, ITFMap } from "@firfi/quint-connect/effect"

const ComplexState = Schema.Struct({
  lookup: ITFMap(ITFSet(ITFBigInt), ITFBigInt),
})
```

### Use fully-qualified state variable names

ITF state keys include module path. Run `quint run --mbt` manually to see actual keys:

```bash
npx @informalsystems/quint run --mbt --max-samples 1 --max-steps 1 specs/cache.qnt
```

Output shows keys like `"cache_test::cache::data"`, not `"data"`.

```ts
const State = Schema.Struct({
  "cache_test::cache::data": ITFMap(Schema.String, ITFBigInt),
  "cache_test::cache::keys": ITFSet(Schema.String),
})
```

Alternative: use `config.statePath` to scope the state:

```ts
return {
  getState: () => ({ data, keys }),
  config: () => ({ statePath: ["cache_test::cache::data"] }),
}
```

### Write a structural comparator for Maps

```ts
import { stateCheck } from "@firfi/quint-connect"

stateCheck(
  (raw) => CacheState.parse(raw),
  (spec, impl) => {
    if (spec.data.size !== impl.data.size) return false
    for (const [k, v] of spec.data) {
      if (!impl.data.has(k) || impl.data.get(k) !== v) return false
    }
    return spec.limit === impl.limit
  },
)
```

### Decode driver picks (action nondet values)

Per-field schemas in `defineDriver` decode the picks for each action:

```ts
import { defineDriver } from "@firfi/quint-connect"
import { ITFBigInt, ITFSet } from "@firfi/quint-connect/zod"

const driver = defineDriver(
  {
    Insert: { key: z.string(), value: ITFBigInt },
    BatchDelete: { keys: ITFSet(z.string()) },
  },
  () => {
    const data = new Map<string, bigint>()
    return {
      Insert: ({ key, value }) => { data.set(key, value) },
      BatchDelete: ({ keys }) => { for (const k of keys) data.delete(k) },
      getState: () => ({ data: new Map(data) }),
    }
  }
)
```

## Common Mistakes

### CRITICAL Hallucinate ITFInt or ITFNumber

Wrong:

```ts
import { ITFInt } from "@firfi/quint-connect/effect"
const State = Schema.Struct({ count: ITFInt })
```

Correct:

```ts
import { ITFBigInt } from "@firfi/quint-connect/effect"
const State = Schema.Struct({ count: ITFBigInt })
```

No `ITFInt`, `ITFNumber`, or `ITFInteger` exists. All Quint integers are `{"#bigint":"N"}` and decode to `bigint` via `ITFBigInt`.

Source: src/itf/schema.ts

### CRITICAL Use Schema.Number or z.number() on ITF integer values

Wrong:

```ts
const State = Schema.Struct({ count: Schema.Number })
```

Correct:

```ts
const State = Schema.Struct({ count: ITFBigInt })
```

ITF integers are `{"#bigint":"42"}`, not raw numbers. `Schema.Number` silently fails or throws a cryptic decode error.

Source: src/itf/schema.ts, README.md

### HIGH Use short variable names in state schema

Wrong:

```ts
// Quint spec has: module cache_test { import cache.* }
const State = Schema.Struct({
  data: ITFMap(Schema.String, ITFBigInt),
})
```

Correct:

```ts
const State = Schema.Struct({
  "cache_test::cache::data": ITFMap(Schema.String, ITFBigInt),
})
```

ITF state keys are fully qualified with module path. Short names decode to `undefined` with no error. Run `quint run --mbt` manually first to see actual keys.

Source: test/runner.test.ts

### CRITICAL Use === or JSON.stringify for Map/Set comparison

Wrong:

```ts
stateCheck(deserialize, (spec, impl) => spec.data === impl.data)
// or:
stateCheck(deserialize, (spec, impl) =>
  JSON.stringify(spec) === JSON.stringify(impl)
)
```

Correct:

```ts
stateCheck(deserialize, (spec, impl) => {
  if (spec.data.size !== impl.data.size) return false
  for (const [k, v] of spec.data) {
    if (!impl.data.has(k) || impl.data.get(k) !== v) return false
  }
  return true
})
```

`===` on Maps/Sets is reference equality (always false for distinct instances). `JSON.stringify` on a Map produces `"{}"`. Both silently produce wrong comparisons.

Source: maintainer interview

### MEDIUM Number(bigint) without bounds checking

Wrong:

```ts
Increment: ({ amount }) => {
  count += Number(amount)
}
```

Correct:

```ts
Increment: ({ amount }) => {
  count += amount  // keep as bigint throughout
}
```

Quint `bigint` can exceed `Number.MAX_SAFE_INTEGER`. Small test constants (1-30) work, but if the spec evolves to larger values, silent precision loss causes false-positive state matches.

Source: maintainer interview

### MEDIUM Write custom Schema.transform instead of using provided schemas

Wrong:

```ts
const MyBigInt = Schema.transform(
  Schema.Struct({ "#bigint": Schema.String }),
  Schema.BigIntFromSelf,
  { decode: (v) => BigInt(v["#bigint"]), encode: (n) => ({ "#bigint": n.toString() }) }
)
```

Correct:

```ts
import { ITFBigInt } from "@firfi/quint-connect/effect"
// Use the provided schema directly — no custom transform needed
```

The library provides tested ITF schemas. Custom transforms duplicate logic, require encode branches that never run, and mislead readers.

Source: src/itf/schema.ts

### HIGH Tension: type safety vs ITF decoding complexity

Fully typed ITF decoding is verbose (fully-qualified keys, `ITFBigInt` everywhere). Shortcuts (raw JSON access, short variable names) produce cleaner code but silently decode to `undefined` or wrong types at runtime. Always use the ITF schemas and verify key names by running `quint run --mbt` manually.

See also: quint-connect-ts-debug/SKILL.md -- ITF decode errors surface as TraceReplayError
