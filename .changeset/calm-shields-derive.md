---
"@provablehq/aleo-bridge-sdk": minor
---

Support Shield-compatible xReserve private mints for local Aleo accounts. The
SDK now reserves persistent counters, derives the scalar and BHP256 address
commitment locally, checkpoints only the public commitment, and retrieves the
scalar from its identity store when submitting `private_mint`.

The Node identity store atomically replaces files with `0600` permissions and
locks reservations across processes sharing the same path.
