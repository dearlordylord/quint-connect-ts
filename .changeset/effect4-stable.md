---
"@firfi/quint-connect": patch
---

Move the Effect 4 line from the `4.0.0-rc.112` release candidate to the stable exact `4.1.4` Effect peer and runtime contract, with Effect Vitest `4.1.4` and its compatible Vitest `5.1.0`. Stable Effect renamed `Config.literals` to `Config.Literals`; the `QUINT_BACKEND` config now uses the new name, so the package loads on stable Effect 4.
