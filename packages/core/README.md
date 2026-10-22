# @provablehq/veil-core

[All Veil packages](../../README.md#packages) · [Documentation](https://provablehq.github.io/veil/packages/core) · [npm](https://www.npmjs.com/package/@provablehq/veil-core) · [LLM index](../../llms.txt)

The foundation of the Veil Aleo SDK: viem-style clients, transports, an
abstract account interface, and actions for reading the chain and writing to
contracts.

Core is platform-agnostic. It carries no React, no runtime globals, and no
hardcoded network or wallet. Chain access goes through a `transport`; signing
goes through an abstract `account`. Reach for it directly when you want a
typed, viem-style client to read Aleo state (blocks, transactions, program
mappings, balances) or to compose your own higher-level client. Every other
`@provablehq/veil-*` package builds on it.

## Installation

```sh
pnpm add @provablehq/veil-core
```

`@provablehq/veil-core` alone does not sign or prove. Concrete signing and proving come
from a companion package:

- **`@provablehq/veil-aleo-sdk`** — local private keys for bots, scripts, and tests.
- **`@provablehq/veil-aleo-wallet-adapter`** — a connected wallet (Shield, Leo) that holds the
  keys and proves on the user's behalf.

## Initialization

Core gives you a read-only `PublicClient` (a transport is all it needs) and a
`WalletClient` for signing. The signing account plugs in one of two ways,
depending on where the keys live.

### Local Key for Programmatic Usage (Using veil as an Aleo SDK)
Your code holds a private key (bots, scripts, servers, tests). For this path, `@provablehq/veil-aleo-sdk` is used to manage accounts, perform proving and signing, and record management.

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')

const { publicClient, walletClient } = aleo.createAleoClient({
  privateKey: 'APrivateKey1...',
  networkUrl: 'https://edge.provable.com/api/v2',
  provingMode: 'delegated', // or 'local' to prove in-process
  proverUrl: 'https://edge.provable.com/api/prove',
})
```

### Wallets with Wallet-Custodied Keys (Web or Mobile Dapps)
A connected web or mobile wallet (Shield, Leo, Puzzle, Fox) holds a user's keys and 
performs signing, proving and record management. `@provablehq/veil-aleo-wallet-adapter` adapts it into an account, 
so the app carries no key or proving config:

```ts
import { createWalletClient, custom, rpcAccount } from '@provablehq/veil-core'

const walletClient = createWalletClient({
  account: rpcAccount(walletAdapter), // walletAdapter from @provablehq/veil-aleo-wallet-adapter
  transport: custom(walletAdapter),
})
```

### Read-Only
To simply read the chain: `createPublicClient({ transport: http(url) })`.

## Reading the chain

A public client needs only a transport. Point `http` at an Aleo node and pass
the target network; every read is a method on the client.

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://edge.provable.com/api/v2', { network: 'testnet' }),
})

// Latest block height.
const height = await client.getBlockNumber()

// Public credit balance for an address, in microcredits.
const balance = await client.getBalance({
  address: 'aleo1...',
})

// A program mapping value, returned as a raw Aleo literal string.
const supply = await client.readContract({
  programId: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1...',
})
```

`readContract` returns the raw literal (e.g. `"5000000u64"`), or `null` when
the key is not in the mapping — absence is a normal answer, not an error.
Decode a non-null value with `parseValue` from the package's utils when you
need a structured value.

### Token standard conformance

`isArc20` and `isArc22` check whether a program implements the ARC-20 or
ARC-22 fungible token interface. The Leo-level interface declaration does not
survive compilation, so the check verifies the compiled instructions
structurally: every interface function and view must exist with the exact
type and visibility at each register position, and the required record types
must carry the required fields. Extra functions, views, or record fields do
not disqualify a program.

Pass a `programId` to fetch a deployed program from the connected node, or
`source` to analyze program text locally without network access.
`checkArcConformance` returns the full report when the boolean verdict is not
enough — each violation names the missing or mismatched function, view, or
record and the expected and actual type at the failing position.

```ts
const ok = await client.isArc20({ programId: 'token.aleo' })

const report = await client.checkArcConformance({
  programId: 'stablecoin.aleo',
  standard: 'arc22',
})
if (!report.conforms) console.log(report.violations)
```

## Writing to contracts

A wallet client pairs a transport with an `account` that signs and proves. Core
defines the account interface; the account instance comes from
`@provablehq/veil-aleo-sdk` or `@provablehq/veil-aleo-wallet-adapter`.

```ts
import { createWalletClient, http } from '@provablehq/veil-core'

const client = createWalletClient({
  account,                                    // from a companion package
  transport: http('https://edge.provable.com/api/v2', { network: 'testnet' }),
})

const txId = await client.writeContract({
  program: 'my_program.aleo',
  function: 'transfer_public',
  inputs: ['aleo1...', '100u64'],
})
```

Wallet clients also carry `simulateContract`, `deployContract`, `transfer`,
`signMessage`, `requestRecords`, and `transactionStatus`, among others. Each
write action is available standalone (tree-shakeable) or as a method on the
client via the `extend()` pattern.

### Reading freezelists

`publicClient.getComplianceFreezeList({ programId })` reads the published
compliance tree as decimal node strings through the configured transport. Pair
it with `readContract({ programId, mapping: 'freeze_list_root', key: '1u8' })`
to validate witnesses against the current root. Core does not load WASM;
`@provablehq/veil-aleo-sdk` supplies `sdk.generateFreezelistProof({ address, tree, root })`
for Node and browser callers. Shield Swap uses this generator automatically on
SDK-backed clients and caches witnesses while the current root is unchanged.

### Wallet-generated freezelist proofs

`freezelistProofRequest` asks a connected wallet to fill one `[MerkleProof; 2]`
input using `program-freezelist-exclusion-proof`. Omit `address` to prove the
signer, or set it for a recipient or withdrawal address. `freezelistProgram`
MUST identify the program owning the root checked by the contract; it is not
necessarily the token program. The helpers construct inputs without network
access. The wallet fetches the list and computes the proof during execution.

```ts
import { freezelistProofRequest, freezelistProofGrant } from '@provablehq/veil-core'

// Supply this grant in the wallet connection's algorithmsAllowed array.
// Position 3 applies to the ARC-22 (recipient, amount, record, proof) shape.
const grant = freezelistProofGrant({
  program: 'token.aleo',
  function: 'transfer_private',
  inputPosition: 3,
  freezelistProgram: 'compliance.aleo',
})

const transactionId = await walletClient.transfer({
  asset: 'token.aleo',
  to: 'aleo1...',
  amount: 100n,
  amountWidth: 'u128',
  visibility: 'private',
  record: { type: 'record', program: 'token.aleo', recordname: 'Token', uid: 'token-record-id' },
  merkleProof: freezelistProofRequest({ freezelistProgram: 'compliance.aleo' }),
})
```

The program names above are illustrative; use the deployed token's actual
freezelist. Create a grant for each executed program, function, and zero-based
proof position. Check the connected wallet's `algorithmsSupported()` before
enabling this flow, and surface wallet rejection errors. The known-algorithm
catalog describes the protocol and does not establish a wallet's support.

`writeContract`, `executeTransaction`, and ABI-backed `getContract` also accept
the request as one complete array input. `transfer` accepts an optional `record`
input after the recipient and amount for ARC-22 private and unshield transfers;
omitting it retains the previous input shape. Local accounts MUST supply encoded
proof strings. Existing encoded proofs remain supported on both account paths.
Use `writeContract` for ARC-20 transfers whose record precedes the recipient.

The agent and MCP `aleo_execute` tool schemas accept encoded strings, wallet
record requests, and freezelist requests. `aleo_transfer` exposes `asset`,
`visibility`, `amountWidth`, `record`, and `merkleProof` with the same behavior
as the client action. Supply amounts above the JavaScript safe-integer limit
as decimal strings to retain every base unit. Wallet grants must already be
configured by the host application; tools do not change connection permissions.

## What's in the box

- **Clients** — `createPublicClient`, `createWalletClient`, `createTestClient`,
  and the lower-level `createClient` they compose from.
- **Transports** — `http`, `custom`, and `fallback` for chain access.
- **Accounts** — the `Account` interface plus `rpcAccount` and `toAccount`
  helpers for adapting a signer to it.
- **Actions** — read actions (`getBlock`, `getTransaction`, `readMapping`,
  `getProgram`, staking and metrics reads, and more) and write actions
  (`writeContract`, `deployContract`, `transfer`, `sendTransaction`).
- **Contract instances** — `getContract` binds an ABI to a client for typed
  reads and writes.
- **Utils and types** — address validation, credit conversion, value and
  record parsing, and the shared types (`Block`, `Transaction`, `Program`,
  `ABI`, account and transport types) the rest of the SDK is built from.

## Extending a client

Clients follow viem's `extend()` pattern, so higher-level packages layer their
methods onto a base client:

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://edge.provable.com/api/v2', { network: 'testnet' }),
}).extend((client) => ({
  async programExists(programId: string) {
    const code = await client.getCode({ programId }).catch(() => null)
    return code != null
  },
}))
```

## Record inventory

Wallet clients expose `getRecordInventory`, `joinRecords`, `splitRecord`,
`autoJoin`, `planRecordInventory`, `rebalanceRecordInventory`, and reconciliation.
Reservations and recovery are off by default. Reads, plans, and individual joins
or splits do not require them. To coordinate writes and execute dependent plans,
pass `recordManagement: { enabled: true, store?, chainId?, maxFeeMicrocredits?, tokenJoin? }`
to `createWalletClient` or `createClient`. Enabling management creates an in-memory
store when no store is supplied; disabled clients allocate none. Core has no
SQLite or Node dependency.

Configure `tokenJoin: { program: 'main_aj_arc20_2_15.aleo' }` on mainnet (or
`test_aj_arc20_2_15.aleo` on testnet) to batch 2–15 ARC20/ARC22 records per join.
Routing also works with `enabled: false`; omitted routing retains native
pairwise joins, and credits are unaffected. `recordActions()` remains an optional
method decorator for custom clients and never enables coordination. Move legacy
`recordActions({ store, maxFeeMicrocredits })` settings into explicitly enabled
client configuration to retain reservation and fee-limit behavior. See the
[record inventory guide](../../site/docs/guides/record-inventory.md).
