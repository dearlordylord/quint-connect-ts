---
"@firfi/quint-connect": patch
---

Adopt `@firfi/itf-trace-parser` 0.2.0-effect4.1 and its hardened Effect schema typings. Effect action-pick schemas and `ItfOption` now explicitly require service-free codecs, matching the existing runtime contract, while map, tuple, and variant schemas retain precise encoded types. Also add isolated packed-consumer publish checks for Node 22.19.0 and Bun 1.3.14.
