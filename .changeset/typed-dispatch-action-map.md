---
"@firfi/quint-connect": major
---

Make typed action dispatch the primary driver API.

The public `Driver` shape is now action-map first and no longer exposes raw `step` dispatch. The simple `defineDriver(factory)` raw-mode overload and `pickFrom` export have been removed; define actions with per-field schemas and handlers instead.
