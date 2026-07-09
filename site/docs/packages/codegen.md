---
sidebar_position: 7
---

# @provablehq/veil-codegen

A build-time generator (library and `veil-codegen` CLI) that reads a parsed
Aleo program ABI and emits TypeScript: struct and record interfaces, decoder
functions, a `PROGRAM_ID` / `PROGRAM_ABI` pair, and a typed contract factory.
Applies when a specific deployed program needs typed bindings instead of
hand-written ones. Consume it as a build-time dev dependency.

## Installation

```bash
npm install -D @provablehq/veil-codegen
```

## Key exports

- **`generate(options)`** — returns the generated TypeScript source as a string. `options.abi` is the parsed ABI; `options.coreImport` overrides the emitted `@provablehq/veil-core` import path (defaults to `'@provablehq/veil-core'`); `options.programId` stamps a `PROGRAM_ID` that differs from the ABI's own program, for bindings shaped from one deployment's ABI but targeting another.
- **`veil-codegen` CLI** — `--abi <path> --out <path>` for a single file, or `--config <path>` (defaults to `veil.config.json`) for a multi-program build.

## Example

Library:

```ts
import { generate } from '@provablehq/veil-codegen'
import { parseAbi } from '@provablehq/veil-core'

const source = generate({ abi: parseAbi(rawAbiJson) })
```

CLI, as a build step:

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

`@provablehq/shield-swap-sdk` uses this generator to produce its
`shield_swap_v3.aleo` bindings — see its package README for a full setup,
including the `programId` override.
