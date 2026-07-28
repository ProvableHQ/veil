---
"@provablehq/veil-core": minor
"@provablehq/veil-codegen": minor
---

Support array and struct values through the whole encode/decode chain: `encodePlaintextValue` encodes plain objects and arrays (including nesting, e.g. `[MerkleProof; 2]`) against ABI type descriptors, `encodeInputs` accepts them natively, record parsing handles array- and struct-valued fields bracket-aware, and codegen emits compiling element-wise decoders for array-typed record fields instead of the previous non-compiling fallthrough.
