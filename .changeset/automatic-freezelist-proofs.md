---
"@provablehq/veil-core": minor
"@provablehq/veil-aleo-sdk": minor
"@provablehq/shield-swap-sdk": minor
"@provablehq/shield-swap-cli": patch
"@provablehq/aleo-bridge-sdk": minor
---

Generate Shield Swap freezelist witnesses automatically by default, validate local witnesses against current chain roots, and cache them while roots remain unchanged. Add a compliance-tree read action and SDK witness generator. Accept per-action literal tuples and annotated proofs alongside existing provider callbacks. Include wallet freezelist grants by default.

Omitted proofs now resolve automatically instead of using unchecked empty witnesses. Undefined per-call proofs inherit a configured provider; null selects automatic resolution. Custom wrappers need explicit freezelist mappings. Opaque positions need their withdrawal address for collect and rebalance.

Resolve Bridge ARC-22 unshield and private xReserve burn compliance proofs automatically. Local accounts generate and cache verified witnesses against current roots; wallet accounts receive signer-only derived requests. Preserve `merkleProof` strings and wallet requests, and accept single-element tuples, annotated proofs, and providers. Public burns remain independent of compliance proofs.
