---
"@provablehq/veil-core": minor
"@provablehq/veil-codegen": minor
"@provablehq/shield-swap-sdk": minor
---

Separate plaintext parsing from record parsing. Breaking — the loose/strict record parsers are removed.

- **`parsePlaintextValue` + `parseRecord` replace `parseRecordPlaintext`/`parseRecordPlaintextLoose`.** Plaintext (literals, structs, arrays) parses into a `PlaintextValue`; records parse through `parseRecord`, which mirrors snarkVM's record grammar (owner, per-entry visibility, `_nonce`) instead of accepting both shapes loosely.
- **Struct values are not records.** Generated struct decoders take a `StructValue` instead of a `RecordValue`, and struct-valued mapping reads decode as plaintext — no phantom owner/visibility metadata.
- **Futures parse typed.** Transition outputs that are futures parse into `FutureValue`, and dynamic futures into their own `DynamicFutureValue`, instead of passing through as text.
- `RecordValue.ownerMode` is renamed to `ownerVisibility`.
