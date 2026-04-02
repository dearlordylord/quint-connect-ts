---
"@firfi/quint-connect": patch
---

Don't force --seed when user doesn't specify one. Without --seed, quint uses fresh random seeds per sample, giving much better coverage for specs with many phase-guarded actions. The generated seed is still reported in error messages for reproducibility.
