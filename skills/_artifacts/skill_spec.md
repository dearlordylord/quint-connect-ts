# @firfi/quint-connect-ts -- Skill Spec

Model-based testing framework connecting Quint formal specifications to TypeScript implementations. Spawns `quint run --mbt`, parses ITF traces, replays them through a user-implemented driver, and compares spec state against implementation state after every step.

## Domains

| Domain | Description | Skills |
| --- | --- | --- |
| Setting up MBT tests | Installing deps, choosing API, writing drivers, wiring state checks, configuring traces | quint-connect-ts-setup |
| Decoding ITF data | Mapping Quint types to ITF JSON encoding to native JS types | quint-connect-ts-itf-decoding |
| Debugging test failures | Diagnosing errors, reproducing with seeds, inspecting traces | quint-connect-ts-debug |

## Skill Inventory

| Skill | Type | Domain | What it covers | Failure modes |
| --- | --- | --- | --- | --- |
| quint-connect-ts-setup | core | setup | defineDriver, run/quintRun, stateCheck, RunOptions, Config, vitest helpers, simple vs Effect API | 6 |
| quint-connect-ts-itf-decoding | core | itf-decoding | ITFBigInt, ITFSet, ITFMap, ITFVariant, ItfOption, transformITFValue, fully-qualified names, Zod re-exports | 6 |
| quint-connect-ts-debug | core | debugging | StateMismatchError, TraceReplayError, NoTracesError, QuintError, seed reproduction, traceDir | 6 |

## Failure Mode Inventory

### quint-connect-ts-setup (6 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
| --- | --- | --- | --- | --- |
| 1 | Hallucinate createDriver/makeDriver API | HIGH | src/simple.ts, README.md | -- |
| 2 | Share mutable state across traces | CRITICAL | README.md, interview | -- |
| 3 | Import from wrong entry point | HIGH | package.json exports | -- |
| 4 | Forget Effect.provide(NodeContext.layer) | HIGH | README.md, src/cli/quint.ts | -- |
| 5 | Destructure trace data from quintRun result | HIGH | src/runner/runner.ts | -- |
| 6 | Add beforeEach/afterEach lifecycle hooks | MEDIUM | interview | -- |

### quint-connect-ts-itf-decoding (6 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
| --- | --- | --- | --- | --- |
| 1 | Hallucinate ITFInt or ITFNumber schema | CRITICAL | src/itf/schema.ts | -- |
| 2 | Use Schema.Number on ITF values | CRITICAL | src/itf/schema.ts | -- |
| 3 | Use short variable names in state schema | HIGH | test/runner.test.ts | -- |
| 4 | Use === for Map/Set comparison | CRITICAL | interview | -- |
| 5 | Number(bigint) without bounds checking | MEDIUM | interview | -- |
| 6 | Generate unused encode branches | MEDIUM | interview | -- |

### quint-connect-ts-debug (6 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
| --- | --- | --- | --- | --- |
| 1 | Re-run without seed | HIGH | README.md, interview | -- |
| 2 | Hack comparator to hide mismatches | HIGH | interview | -- |
| 3 | Return live mutable object from getState | CRITICAL | interview | -- |
| 4 | Use nTraces: 1 in CI | MEDIUM | interview | -- |
| 5 | Hardcode relative spec path | MEDIUM | examples/ | -- |
| 6 | Use Effect.orDie in state deserializer | MEDIUM | interview | quint-connect-ts-setup |

## Tensions

| Tension | Skills | Agent implication |
| --- | --- | --- |
| Setup simplicity vs production robustness | quint-connect-ts-setup <-> quint-connect-ts-debug | Agent generates minimal code that passes initially but masks bugs |
| Type safety vs ITF decoding complexity | quint-connect-ts-setup <-> quint-connect-ts-itf-decoding | Agent simplifies schemas for readability, producing silent decode failures |

## Cross-References

| From | To | Reason |
| --- | --- | --- |
| quint-connect-ts-setup | quint-connect-ts-itf-decoding | Setup requires ITF schemas for picks and state |
| quint-connect-ts-setup | quint-connect-ts-debug | First test run often fails; need to read errors and use seed |
| quint-connect-ts-itf-decoding | quint-connect-ts-debug | ITF decode errors are a subset of TraceReplayError |

## Subsystems & Reference Candidates

| Skill | Subsystems | Reference candidates |
| --- | --- | --- |
| quint-connect-ts-setup | -- | -- |
| quint-connect-ts-itf-decoding | -- | ITF type mapping table (7 types) |
| quint-connect-ts-debug | -- | -- |

## Effect 3 vs Effect 4

Two versions are published under different npm dist-tags: `@latest` (Effect 3, `effect@^3`) and `@effect4` (Effect 4, `effect@^4`). This only matters when the project already uses `effect` as a dependency. The Simple API (Zod / Standard Schema) is identical across both. The Effect API has minor naming differences (`Schema.TaggedError` vs `Schema.TaggedErrorClass`, `Schema.decodeUnknown` vs `Schema.decodeUnknownEffect`, etc.) but the quint-connect user-facing API is the same. Full details in `quint-connect-ts-setup`.

## Remaining Gaps

No gaps -- all resolved in interview.

## Recommended Skill File Structure

- **Core skills:** quint-connect-ts-setup, quint-connect-ts-itf-decoding, quint-connect-ts-debug (all framework-agnostic)
- **Framework skills:** none (library is framework-agnostic)
- **Lifecycle skills:** none
- **Composition skills:** none (Effect/Zod/vitest integration folded into setup)
- **Reference files:** none needed (each skill under 500 lines)

## Composition Opportunities

| Library | Integration points | Composition skill needed? |
| --- | --- | --- |
| Quint CLI | Subprocess spawning, --mbt flag | No -- covered in setup |
| Effect + @effect/platform-node | Effect API path, Schema, NodeContext | No -- covered in setup |
| vitest | quintTest, quintIt helpers | No -- covered in setup |
| Zod | @firfi/quint-connect-ts/zod re-exports | No -- covered in itf-decoding |
| Standard Schema libs (Valibot, ArkType) | Simple API pick validation | No -- trivial |
