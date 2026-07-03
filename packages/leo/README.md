# @veil/leo

Wraps the Leo CLI in a typed TS/JS client. The client shells out to the `leo`
binary and exposes its `build`, `abi`, `deploy`, and `synthesize` commands as
async methods, with the CLI flags surfaced as typed options objects instead of
string arguments.

Reach for it when a script, test, or tool needs to compile, deploy, or generate
an ABI for a Leo program without hand-assembling `leo` command lines. It composes
onto any veil client through `.extend()`, so a test client can compile a program
and mine a block from one call site.

## Installation

```sh
pnpm add @veil/leo
```

This package spawns the `leo` binary — it does not vendor the Leo toolchain. The
`leo` CLI MUST be installed and on `PATH` (or given explicitly via `leoPath`).
See the [Leo installation guide](https://developer.aleo.org/leo/installation).

## Usage

`leoActions` attaches a `LeoClient` under the `.leo` property of any veil client.
The extension ignores the host client — Leo operations run locally and need no
transport — so it works on a public, wallet, or test client alike.

```ts
import { createTestClient } from '@veil/core'
import { leoActions } from '@veil/leo'

const client = createTestClient({ transport }).extend(
  leoActions({ cwd: './my-program', network: 'testnet' }),
)

// Compile the package at cwd.
await client.leo.build()

// Deploy it, broadcasting the transaction and skipping the prompt.
await client.leo.deploy({ broadcast: true, yes: true })

// Generate an ABI from a compiled .aleo bytecode file.
const abi = await client.leo.abi({ file: 'build/main.aleo' })
```

Config passed to `leoActions` (or `createLeoClient`) sets defaults for every
command — `cwd`, `network`, `endpoint`, `privateKey`, `leoPath`, and the global
flags. Any option passed to an individual method overrides that default for the
call.

For a standalone client with no host to extend, call `createLeoClient` directly:

```ts
import { createLeoClient } from '@veil/leo'

const leo = createLeoClient({ cwd: './my-program' })
await leo.build()
```

## Methods

- **`build(options?)`** — `leo build`. Compiles the package at `cwd`.
- **`deploy(options?)`** — `leo deploy`. Compiles and deploys; `broadcast` sends
  the transaction to the network and costs a fee. Set `yes` to skip the prompt.
- **`abi(options)`** — `leo abi`. Reads a `.aleo` bytecode file and returns the
  ABI as a string. Pass `output` to write it to a path instead (returns `""`).
- **`synthesize(options)`** — `leo synthesize`. Synthesizes proving and verifying
  keys for the named program.

Standalone functions cover the rest of the toolchain without a client:
`build`, `buildBatch` (compile several project directories in sequence), `abi`
(`leo abi` a compiled `.aleo` file, returning the ABI JSON), `run` (`leo run`
a function with inputs), and `clean` (`leo clean`).

## Errors

Every method rejects if `leo` exits non-zero, with the failing subcommand and exit
code in the message. If the binary cannot be spawned at all — not installed, not
on `PATH` — the error names the missing `leo` and links the installation guide.
