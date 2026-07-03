# @veil/codegen

Generates TypeScript bindings from an Aleo program's ABI, and ships the
`veil-codegen` CLI that drives it.

Reach for it as a package maintainer, not a consumer: point it at a program's
`abi.json` and it emits a `.ts` module of struct and record interfaces, record
and struct decoders (`RecordValue` → typed interface), per-function input and
output types, mapping and storage types, the parsed `PROGRAM_ABI` constant, and
a typed contract factory (`read`/`write`/`simulate`/`execute`). A package like
`@veil/shield-swap` commits that output and ships it — a consumer installing the
package gets the bindings already. You run codegen when the upstream contract
drifts (redeploy, a new or renamed entrypoint, struct, or mapping) and the
checked-in bindings need to catch up.

## Installation

It is a build-time tool, so install it as a dev dependency:

```sh
pnpm add -D @veil/codegen
```

## Usage

### CLI

Two modes. Generate one file directly with `--abi` + `--out`:

```sh
veil-codegen --abi ./abi/loyalty_token.json --out ./src/generated/loyalty_token.ts
```

Or drive one or more programs from a config file with `--config` (this is how
`@veil/shield-swap` wires it — a `generate` script runs
`veil-codegen --config codegen/veil.config.json`):

```sh
veil-codegen --config veil.config.json
```

Flags:

- `--abi <path>` — path to the program's `abi.json`. Pair with `--out`.
- `--out <path>` — output `.ts` file. Parent directories are created if missing.
- `--config <path>` — path to a config JSON. Defaults to `veil.config.json`.
- `--core-import <path>` — import specifier for `@veil/core` in the emitted
  file. Defaults to `@veil/core`; on the CLI it overrides the config's
  `coreImport`.
- `--help`, `-h` — print usage.

Paths inside a config file resolve relative to the config file's own location,
not the working directory.

### Config file

```json
{
  "programs": [
    {
      "abi": "./abi/shield_swap_v0_0_2.json",
      "out": "../src/generated/shield_swap.ts"
    }
  ],
  "coreImport": "@veil/core"
}
```

- `programs` — one entry per program to generate. Each has an `abi` path and an
  `out` path, both resolved relative to the config file.
- `programs[].programId` — optional. Stamps a `PROGRAM_ID` (and factory target)
  that differs from the ABI's own `program`. Set it when the bindings take their
  shape from one deployment's ABI but must target another, identical-shape
  deployment. Defaults to the ABI's `program`.
- `coreImport` — optional. Import specifier for `@veil/core` in every emitted
  file. Defaults to `@veil/core`.

### Programmatic API

`generate` takes an already-parsed ABI and returns the TypeScript source as a
string; it writes nothing and touches no network. Parse the ABI with
`parseAbi` from `@veil/core` first, then write the result yourself. This is the
path to take when you generate as part of a larger build step rather than from
the CLI.

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { parseAbi } from '@veil/core'
import { generate } from '@veil/codegen'

const abi = parseAbi(JSON.parse(readFileSync('./abi/loyalty_token.json', 'utf-8')))
const source = generate({ abi, coreImport: '@veil/core' })
writeFileSync('./src/generated/loyalty_token.ts', source)
```

`generate(options)` accepts `GenerateOptions`:

- `abi` — the parsed `ABI` to generate from.
- `coreImport` — optional import specifier for `@veil/core`. Defaults to
  `@veil/core`.
- `programId` — optional override for the emitted `PROGRAM_ID`, same meaning as
  the config field above. Defaults to the ABI's `program`.
</content>
</invoke>
