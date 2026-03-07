# Bug Report: `--backend typescript` corrupts `mbt::actionTaken` for non-disjunctive step actions

## Summary

When a Quint spec has a single-body step action (not `any { ... }` with named disjuncts), running with `--mbt --backend typescript` causes ALL non-init states to have `mbt::actionTaken: "init"` instead of the actual action name. The `--backend rust` (default) is unaffected.

## Reproduction

Spec (`single_step.qnt`):
```quint
module single_step {
  var count: int
  action init = { count' = 0 }
  action step = { count' = count + 1 }
}
```

```sh
# BUG: all states show "init"
quint run single_step.qnt --mbt --backend typescript --n-traces 1 --max-steps 3 --seed 1

# [State 0] { count: 0, mbt::actionTaken: "init", mbt::nondetPicks: {  } }
# [State 1] { count: 1, mbt::actionTaken: "init", mbt::nondetPicks: {  } }  <-- should be "step"
# [State 2] { count: 2, mbt::actionTaken: "init", mbt::nondetPicks: {  } }  <-- should be "step"

# CORRECT: --backend rust
quint run single_step.qnt --mbt --backend rust --n-traces 1 --max-steps 3 --seed 1

# [State 0] { count: 0, mbt::actionTaken: "init", mbt::nondetPicks: {  } }
# [State 1] { count: 1, mbt::actionTaken: "step", mbt::nondetPicks: {  } }
# [State 2] { count: 2, mbt::actionTaken: "step", mbt::nondetPicks: {  } }
```

Specs using `any { ... }` are NOT affected — the `any` combinator internally resets `actionTaken`, masking the bug:
```quint
action step = any { Increment }  // actionTaken correctly shows "Increment"
```

Tested on Quint v0.31.0.

## Root Cause

The TypeScript backend's `Context.shift()` does not reset MBT metadata (`actionTaken`, `nondetPicks`) after recording a state into the trace. The Rust backend does.

### How `actionTaken` works

`actionTaken` uses first-write-wins semantics. In `builder.ts` (`buildDefCore`, around line 240):

```typescript
// quint/src/runtime/impl/builder.ts
if (ctx.varStorage.actionTaken === undefined) {
  ctx.varStorage.actionTaken = def.name
}
```

This means `actionTaken` is only set if it's currently `undefined`. It's designed to capture the first (outermost) action name in a step.

### The bug: `Context.shift()` doesn't clear metadata

```typescript
// quint/src/runtime/impl/Context.ts
shift() {
  this.varStorage.shiftVars()
  this.trace.extend(this.varStorage.asRecord())
  // BUG: actionTaken and nondetPicks are NOT reset here
}
```

The simulation loop in `evaluator.ts`:
1. `reset()` — sets `actionTaken = undefined`
2. `init` executes — sets `actionTaken = "init"` (first write, correct)
3. `shift()` — records state, but does NOT reset `actionTaken`
4. `step` executes — tries to set `actionTaken = "step"`, but the guard (`=== undefined`) is false because it's still `"init"`
5. `shift()` — records state with `actionTaken = "init"` (wrong)
6. Repeat steps 4-5 for every subsequent step

### Why `any { ... }` masks the bug

The `actionAny` handler in `builtins.ts` (around line 160) manually resets `actionTaken` before evaluating each branch:

```typescript
// quint/src/runtime/impl/builtins.ts — actionAny case
ctx.varStorage.actionTaken = undefined
ctx.varStorage.nondetPicks.forEach((_, key) => {
  ctx.varStorage.nondetPicks.set(key, undefined)
})
```

So when `step = any { Increment }`, the `any` resets `actionTaken` to `undefined`, allowing `Increment` to set it correctly.

### How the Rust backend does it correctly

```rust
// quint/evaluator/src/evaluator.rs, line ~129-137
pub fn shift(&mut self) {
    self.var_storage.borrow_mut().shift_vars();
    let value = self.var_storage.borrow().as_record();
    // ...
    self.trace.push(State { value, diagnostics });
    self.var_storage.borrow_mut().clear_metadata();  // <-- clears actionTaken + nondetPicks
}
```

```rust
// quint/evaluator/src/storage.rs
pub fn clear_metadata(&mut self) {
    if self.store_metadata {
        self.action_taken = None;
        self.nondet_picks.clear();
    }
}
```

## Fix

Add a `clearMetadata()` method to `VarStorage` and call it in `Context.shift()`:

### 1. `quint/src/runtime/impl/VarStorage.ts` — add method

```typescript
clearMetadata() {
  if (this.storeMetadata) {
    this.actionTaken = undefined
    this.nondetPicks.forEach((_, key) => {
      this.nondetPicks.set(key, undefined)
    })
  }
}
```

### 2. `quint/src/runtime/impl/Context.ts` — call after recording

```typescript
shift() {
  this.varStorage.shiftVars()
  this.trace.extend(this.varStorage.asRecord())
  this.varStorage.clearMetadata()
}
```

This mirrors the Rust backend's behavior exactly.

## Impact

Any MBT consumer that dispatches on `mbt::actionTaken` (e.g., quint-connect, quint's own trace validation) will see incorrect action names when using `--backend typescript` with non-disjunctive step actions. This makes it impossible to distinguish which action was taken in each step.

## Workarounds

- Use `--backend rust` (the CLI default)
- Structure step actions as `any { ... }` with named disjuncts
