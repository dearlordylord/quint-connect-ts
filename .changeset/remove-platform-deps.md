---
"@firfi/quint-connect": minor
---

Remove @effect/platform-node dependency, eliminating transitive peer dep chain

BREAKING CHANGES:
- `quintTest` and `quintIt` now take the test function as the first argument:
  - `quintTest(test, name, opts)` instead of `quintTest(name, opts)`
  - `quintIt(it.effect, name, opts)` instead of `quintIt(name, opts)`
- `quintRun` no longer requires `FileSystem | Path | ChildProcessSpawner` in its Effect requirements type

Other changes:
- CLI subprocess handling rewritten to use Node.js APIs directly (child_process, fs/promises)
- Added child process cleanup via AbortSignal for interruption safety
- Rust backend "step" action (no-op) now silently skipped in typed driver mode
- Removed all unnecessary `Effect.scoped` and `Effect.provide(NodeServices.layer)` wrappers
