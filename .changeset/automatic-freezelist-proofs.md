---
"@provablehq/veil-core": minor
"@provablehq/veil-aleo-sdk": minor
"@provablehq/shield-swap-sdk": minor
"@provablehq/shield-swap-cli": patch
---

Generate Shield Swap freezelist witnesses automatically by default, validate local witnesses against current chain roots, and cache them while roots remain unchanged. Add a compliance-tree read action and SDK witness generator. Accept per-action literal tuples and annotated proofs alongside existing provider callbacks. Include wallet freezelist grants by default.

Omitted proofs now resolve automatically instead of using unchecked empty witnesses. Undefined per-call proofs inherit a configured provider; null selects automatic resolution. Custom wrappers need explicit freezelist mappings. Opaque positions need their withdrawal address for collect and rebalance.
