# Project Instructions

Rules are reflexive: when adding a rule, apply it immediately.

## Package Manager

Use `pnpm`, not npm. Prefer package.json scripts over raw commands (e.g., `pnpm typecheck` not `pnpm tsc --noEmit`).

## Verification

Run before considering work complete:
1. `pnpm run ci`

## Type Safety

Type casts (`as T`) are a sin. Avoid them. All data crossing system boundaries (APIs, ITF files, CLI output) must be strongly typed with Effect Schema.

## Effect Best Practices

- Use `Effect.gen` for async/sequential composition
- Use `Schema.TaggedError` for all error types
- Use `Effect.scoped` for resource management (temp directories)
- No `as` casts — parse with Schema at boundaries
- Services via `Context.Tag` pattern when needed

## Architecture

- `src/itf/` — ITF Option/MbtMeta schemas; ITF type decoders via `@firfi/itf-trace-parser`
- `src/driver/` — Driver interface, Step, Config types
- `src/cli/` — Quint CLI subprocess spawning and trace file reading
- `src/runner/` — Trace replay orchestration and state comparison
- `src/simple.ts` — Simple (non-Effect) API: `run`, `pick`, sync decoders
- `src/effect.ts` — Effect API re-exports
- `src/index.ts` — Default entry point, re-exports simple API

Dual entry points: `@firfi/quint-connect` (simple) and `@firfi/quint-connect/effect` (Effect).

## Key Design Decisions

- **Backend**: No `--backend` flag by default (inherits quint CLI default = `rust`). `--backend typescript` has a known bug with non-disjunctive step actions.
- **State comparison**: Full comparison after every step (Rust feature parity)
- **Framework-agnostic**: Throws on failure, works with any test runner
- **Temp directory**: Effect-managed scoped resource, auto-cleanup
- **ITF types**: Via `@firfi/itf-trace-parser`; Quint-specific schemas (ItfOption, MbtMeta) in `src/itf/`
- **Dual API**: Simple API (default) wraps Effect internals; Effect API for advanced users
- **Releases**: Use `npx changeset` to describe changes, `pnpm local-release` to version + publish
