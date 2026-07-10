# simulateContract

Executes a program function locally and returns its outputs without
broadcasting.

The Aleo equivalent of a dry run: it runs the program logic locally through
the proving config's `simulate` method and returns the resulting output
values and records as strings, leaving no on-chain trace and costing no fee.
Only available for local SDK accounts whose proving config implements
`simulate` — a wallet-adapter (RPC) account throws, since there is no wallet
step to simulate against.

## Usage

```ts
import { createWalletClient, http } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const account = aleo.privateKeyToAccount('APrivateKey1...')

const client = createWalletClient({
  account,
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
  proving: aleo.createProvingConfig({
    mode: 'local',
    networkUrl: 'https://api.provable.com/v2',
    account,
  }),
})

const { outputs } = await client.simulateContract({
  program: 'token.aleo',
  function: 'transfer_public',
  inputs: ['aleo1...', '100u64'],
})
```

## Returns

`{ transitions: RawTransitionResult[]; outputs: string[] }`

`outputs` holds the outputs of the called function's own transition;
`transitions` carries every transition the call would produce, including
inner cross-program calls, each tagged with its program and function name.
Nothing is broadcast, so there is no transaction id.

## Parameters

### program

- **Type:** `string`

Program id, e.g. `token.aleo`.

### programSource

- **Type:** `string`

Program source to run against instead of fetching it from the chain. Use it
for a program not yet deployed.

### function

- **Type:** `string`

Function or transition name to invoke within `program`.

### inputs

- **Type:** `string[]`

Function inputs as Aleo-encoded literal strings (e.g. `'100u64'`,
`'aleo1...'`). InputRequest objects are rejected — simulation runs with no
wallet available to fulfil them.

### imports

- **Type:** `Record<string, string>`

Program id to source, for programs reached through dynamic dispatch that
cannot be discovered statically. Static imports are auto-discovered.
