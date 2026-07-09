---
sidebar_position: 7
---

# @provablehq/veil-codegen

A build-time generator (library + `veil-codegen` CLI) that reads a parsed Aleo
program ABI and emits TypeScript: struct/record interfaces, decoder functions, a
`PROGRAM_ID` / `PROGRAM_ABI`, and a typed contract factory. Use it to get typed
bindings for a specific deployed program instead of hand-writing them.

```bash
npm install -D @provablehq/veil-codegen
```

## Key exports

- **`generate(options)`** — returns the generated TypeScript source. Options: `abi` (parsed ABI), `coreImport?` (default `'@provablehq/veil-core'`), `programId?` (stamp a `PROGRAM_ID` that differs from the ABI's own program).
- **`veil-codegen` CLI** — `--abi <path> --out <path>`, or `--config <veil.config.json>`.

## Usage

Library:

```ts
import { generate } from '@provablehq/veil-codegen'
import { parseAbi } from '@provablehq/veil-core'

const source = generate({ abi: parseAbi(rawAbiJson) })
```

CLI (typical build step):

```bash
veil-codegen --config veil.config.json
```

```json
// veil.config.json
{
  "programs": [
    { "abi": "./abi/my_program.json", "out": "./src/generated/my_program.ts", "programId": "my_program.aleo" }
  ],
  "coreImport": "@provablehq/veil-core"
}
```

`@provablehq/shield-swap-sdk` uses this to generate its `shield_swap` bindings — see its
package README for a full setup, including the `programId` override.
