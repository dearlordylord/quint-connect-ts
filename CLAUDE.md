# Project Instructions

Rules are reflexive: when adding a rule, apply it immediately.

## Package Manager

Use `pnpm`, not npm. Prefer package.json scripts over raw commands (e.g., `pnpm typecheck` not `pnpm tsc --noEmit`).

## Verification

Run before considering work complete:
1. `pnpm build && pnpm typecheck && pnpm lint && pnpm test`

## Type Safety

Type casts (`as T`) are a sin. Avoid them. All data crossing system boundaries (APIs, ITF files, CLI output) must be strongly typed with Effect Schema.

## Effect Best Practices

- Use `Effect.gen` for async/sequential composition
- Use `Schema.TaggedError` for all error types
- Use `Effect.scoped` for resource management (temp directories)
- No `as` casts — parse with Schema at boundaries
- Services via `Context.Tag` pattern when needed

## Architecture

- `src/itf/` — ITF format types and effect/Schema parsers (Apalache ADR-015)
- `src/driver/` — Driver interface, Step, Config types
- `src/cli/` — Quint CLI subprocess spawning and trace file reading
- `src/runner/` — Trace replay orchestration and state comparison
- `src/index.ts` — Public API re-exports

## Key Design Decisions

- **Backend**: `--backend typescript` by default (zero extra deps)
- **State comparison**: Full comparison after every step (Rust feature parity)
- **Framework-agnostic**: Throws on failure, works with any test runner
- **Temp directory**: Effect-managed scoped resource, auto-cleanup
- **ITF types**: Own schemas, not importing from @informalsystems/quint internals
