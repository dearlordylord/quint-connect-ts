---
"@firfi/quint-connect": minor
---

Remove onInit hook, dispatch step 0 as regular action (Rust quint-connect parity)

BREAKING: `onInit` removed from Driver, defineDriver, and SimpleDriver. Step 0 is now dispatched as a regular action. With TS backend, step 0 is silently skipped when handler is missing. With Rust backend, define an init handler in your action map.
