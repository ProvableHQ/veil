---
sidebar_position: 1
---

# Public Client

A public client reads Aleo chain state and nothing else: blocks, transactions,
balances, program mappings, staking data, and network metrics. It carries no
account and no proving configuration, so it cannot sign or submit a
transaction — every method is a network read through its transport. This
mirrors viem's `publicClient`: the read surface is separate from the write
surface, so an application can hold a public client with no wallet connected
at all.

## Create a public client

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})
```

`createPublicClient` takes a `PublicClientConfig`:

| Field | Type | Description |
| --- | --- | --- |
| `transport` | `Transport` | Carries every read request to the network. See [Transports](/clients/transports). |
| `key` | `string` (optional) | Identifier for the client's type. Defaults to `'public'`. |
| `name` | `string` (optional) | Human-readable name. Defaults to `'Public Client'`. |

## Actions

Every method below hits the network through the client's transport and
returns a typed result. Full parameters, return types, and examples live on
each action's own page.

### Chain state

| Action | Description |
| --- | --- |
| [`getBlockNumber`](/api/public/getBlockNumber) | Latest block height. |
| [`getBlockHash`](/api/public/getBlockHash) | Latest block hash. |
| [`getBlock`](/api/public/getBlock) | Block by height or hash. |
| [`getBlocks`](/api/public/getBlocks) | Blocks in a height range. |
| [`getBlockTransactions`](/api/public/getBlockTransactions) | Confirmed transactions in a block, by height. |
| [`getBlockTransactionsByHash`](/api/public/getBlockTransactionsByHash) | Confirmed transactions in a block, by hash. |
| [`getBlockHeightByHash`](/api/public/getBlockHeightByHash) | Height of the block with the given hash. |
| [`getBlockSummary`](/api/public/getBlockSummary) | Summary of the latest 1000 blocks. |
| [`getStateRoot`](/api/public/getStateRoot) | Global state root at a height, or the latest. |
| [`getStatePath`](/api/public/getStatePath) | Merkle path proving a record commitment's inclusion. |
| [`getStatePaths`](/api/public/getStatePaths) | Merkle paths for multiple commitments. |
| [`findBlockHeightByStateRoot`](/api/public/findBlockHeightByStateRoot) | Height of the block that produced a state root. |
| [`findBlockHash`](/api/public/findBlockHash) | Hash of the block containing a transaction. |

### Transactions

| Action | Description |
| --- | --- |
| [`getTransaction`](/api/public/getTransaction) | Full transaction by id. |
| [`getConfirmedTransaction`](/api/public/getConfirmedTransaction) | Confirmed transaction, wrapped with accepted/rejected status. |
| [`getUnconfirmedTransaction`](/api/public/getUnconfirmedTransaction) | Transaction in its as-submitted form. |
| [`getTransactionByTransition`](/api/public/getTransactionByTransition) | Transaction that contains a given transition. |
| [`getTransactionsByAddress`](/api/public/getTransactionsByAddress) | Transactions involving an address. |
| [`getTransactionSummary`](/api/public/getTransactionSummary) | Summary of the latest 1000 transactions. |
| [`findTransactionId`](/api/public/findTransactionId) | Transaction id that contains a transition. |

### Transitions

| Action | Description |
| --- | --- |
| [`getTransitions`](/api/public/getTransitions) | Transition summaries involving an address. |
| [`findTransitionId`](/api/public/findTransitionId) | Transition id that consumed or produced an input/output. |
| [`getTransitionViewKeys`](/api/public/getTransitionViewKeys) | View keys for a transition's outputs. |

### Programs, mappings & editions

| Action | Description |
| --- | --- |
| [`getCode`](/api/public/getCode) | Program source code. |
| [`getProgram`](/api/public/getCode) | Alias of `getCode`. |
| [`readContract`](/api/public/readContract) | Read a mapping value. |
| [`readMapping`](/api/public/readMapping) | Alias for `readContract`. |
| [`getMappingNames`](/api/public/getMappingNames) | Mapping names declared by a program. |
| [`getDeploymentTransaction`](/api/public/getDeploymentTransaction) | Transaction that deployed a program. |
| [`getProgramCalls`](/api/public/getProgramCalls) | Latest calls into a program. |
| [`getProgramCallsPaginated`](/api/public/getProgramCallsPaginated) | Calls into a program, paginated. |
| [`getLatestEdition`](/api/public/getLatestEdition) | Latest edition number for an upgradeable program. |
| [`getProgramByEdition`](/api/public/getProgramByEdition) | Program source at a specific edition. |
| [`getAmendmentCount`](/api/public/getAmendmentCount) | Number of amendments made to a program. |
| [`getAmendmentCountByEdition`](/api/public/getAmendmentCountByEdition) | Amendment count as of a specific edition. |
| [`getDeploymentTransactionByEdition`](/api/public/getDeploymentTransactionByEdition) | Deployment transaction for a specific edition. |
| [`getOriginalDeploymentTransaction`](/api/public/getOriginalDeploymentTransaction) | The program's first deployment transaction. |
| [`getAmendmentDeploymentTransaction`](/api/public/getAmendmentDeploymentTransaction) | Deployment transaction for a specific amendment. |
| [`getProgramIdByAddress`](/api/public/getProgramIdByAddress) | Program id owning a given program address. |
| [`getProgramAddress`](/api/public/getProgramAddress) | Program address for a given program id. |

### Account

| Action | Description |
| --- | --- |
| [`getBalance`](/api/public/getBalance) | Public credits balance for an address, in microcredits. |

### Committee & staking

| Action | Description |
| --- | --- |
| [`getCommittee`](/api/public/getCommittee) | Current or historical validator committee. |
| [`getDelegators`](/api/public/getDelegators) | Delegator addresses bonded to a validator. |
| [`getStakingEarnings`](/api/public/getStakingEarnings) | Cumulative staking rewards for an address. |

### Metrics

| Action | Description |
| --- | --- |
| [`getTransactionMetrics`](/api/public/getTransactionMetrics) | Daily transaction counts. |
| [`getProgramMetrics`](/api/public/getProgramMetrics) | Program call counts over the last 7 days. |
| [`getProgramMetricsByRange`](/api/public/getProgramMetricsByRange) | Program call counts over a custom range. |
| [`getApy`](/api/public/getApy) | Current network-wide staking APY. |
| [`getValidatorApy`](/api/public/getValidatorApy) | Per-validator APY. |

### Supply & tokens

| Action | Description |
| --- | --- |
| [`getTotalSupply`](/api/public/getTotalSupply) | Total ALEO supply. |
| [`getCirculatingSupply`](/api/public/getCirculatingSupply) | Circulating ALEO supply. |
| [`getTvl`](/api/public/getTvl) | Total value locked across DeFi programs. |
| [`getTokens`](/api/public/getTokens) | Token registry data. |
| [`getTokenDetails`](/api/public/getTokenDetails) | Detail record for one token. |

## Examples

### Read a mapping value

```ts
const balance = await client.readContract({
  programId: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1...',
})
// '5000000u64'
```

### Get the current block

```ts
const height = await client.getBlockNumber()
const block = await client.getBlock({ height: Number(height) })
console.log(block.block_hash, block.header.metadata.timestamp)
```

### Query staking state

```ts
const committee = await client.getCommittee()
const delegators = await client.getDelegators({ validator: 'aleo1validator...' })
const earnings = await client.getStakingEarnings({ address: 'aleo1...' })
```

## `extend()`

`createPublicClient` builds on the base client returned by `createClient` and
layers its read actions on with `extend`. Any client — public, wallet, or
test — can take the same path to add its own methods without losing what an
earlier `extend` call attached:

```ts
const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
}).extend((base) => ({
  getBlockAge: async () => {
    const block = await base.request({ method: 'getBlock', params: {} })
    return Date.now() / 1000 - (block as any).header.metadata.timestamp
  },
}))
```

Each `extend` call returns a new client carrying the base client's properties
plus whatever the passed function returns, so decorators compose — this is
how `publicActions`, `walletActions`, `testActions`, `devnodeActions`, and
`leoActions` are all implemented.
