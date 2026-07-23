---
"@provablehq/veil-core": minor
---

Add ARC-20/ARC-22 conformance actions (`isArc20`, `isArc22`, `checkArcConformance`, pure `checkProgramConformance`) and the `aleo_check_arc_conformance` agent tool.

`parseProgram` now models the full snarkVM surface: `record`/`struct` declarations, `view` blocks, and every `ValueType` register variant (arrays incl. nested, external records/structs, futures, `dynamic.record`/`dynamic.future`). Breaking for code that constructs `Program` values by hand or reads register shapes: `Program` gains required `kind: 'program'`, `records`, `structs`, and `views` fields, and function inputs/outputs are now `ProgramRegister` — a `kind`-discriminated union where only plaintext registers carry `visibility`. Code that consumes `parseProgram()` output positionally (names, `hasFinalize`, mappings) is unaffected.
