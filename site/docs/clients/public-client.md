---
sidebar_position: 1
---

# Public Client

The public client provides read-only access to the Aleo network. No wallet or account needed.

## Create a Public Client

```ts
import { createPublicClient, http } from '@veil/core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})
```

## Actions

### Chain State

| Action | Description |
|---|---|
| `getBlockNumber()` | Latest block height |
| `getBlock({ height })` | Block by height or hash |
| `getBlockHash()` | Latest block hash |
| `getBlockHeightByHash({ hash })` | Block height for a block hash |
| `getBlocks({ start, end })` | Range of blocks (max 50) |
| `getBlockTransactions({ height })` | Transactions in a block |
| `getBlockTransactionsByHash({ hash })` | Transactions in a block, by hash |
| `getBlockSummary()` | Summary of latest 1000 blocks |
| `getStateRoot({ height? })` | State root at height |
| `getStatePath({ commitment })` | State path for a commitment |
| `getStatePaths({ commitments })` | Batched state paths |
| `findBlockHeightByStateRoot({ stateRoot })` | Block height for a state root |

### Transactions

| Action | Description |
|---|---|
| `getTransaction({ id })` | Transaction by ID |
| `getTransactionByTransition({ transitionId })` | Transaction containing a transition |
| `getConfirmedTransaction({ id })` | Confirmed transaction from ledger |
| `getUnconfirmedTransaction({ id })` | Unconfirmed transaction from mempool |
| `getTransactionsByAddress({ address })` | Transactions for an address |
| `getTransactionSummary()` | Summary of latest 1000 transactions |
| `findBlockHash({ transactionId })` | Block hash containing a transaction |
| `findTransactionId({ transitionId })` | Transaction ID from transition ID |

### Transitions

| Action | Description |
|---|---|
| `getTransitions({ address })` | Transitions for an address |
| `findTransitionId({ inputOrOutputId })` | Transition ID from input/output ID |

### Programs & Mappings

| Action | Description |
|---|---|
| `getCode({ program })` | Program source code (Aleo bytecode) |
| `getProgram({ program })` | Same as `getCode`, returning a parsed `Program` |
| `readContract({ program, mapping, key })` | Read a mapping value |
| `readMapping({ program, mapping, key })` | Alias for `readContract` |
| `getMappingNames({ program })` | List mapping names for a program |
| `getDeploymentTransaction({ program })` | Latest deployment transaction for a program |
| `getOriginalDeploymentTransaction({ program })` | First (edition 0) deployment transaction |
| `getDeploymentTransactionByEdition({ program, edition })` | Deployment transaction for a specific edition |
| `getAmendmentDeploymentTransaction({ program, edition })` | Amendment deployment transaction |
| `getLatestEdition({ program })` | Latest edition number for a program |
| `getProgramByEdition({ program, edition })` | Program source at a specific edition |
| `getAmendmentCount({ program })` | Number of amendments to a program |
| `getAmendmentCountByEdition({ program, edition })` | Amendment count up to an edition |
| `getProgramAddress({ program })` | Aleo address for a program |
| `getProgramIdByAddress({ address })` | Program id for a program address |
| `getProgramCalls({ program })` | Latest 1000 calls to a program |
| `getProgramCallsPaginated({ program, page, perPage })` | Paginated calls to a program |
| `getTransitionViewKeys({ transactionId })` | Transition view keys for a transaction |

### Account

| Action | Description |
|---|---|
| `getBalance({ address })` | Credits balance for an address |

### Committee & Staking

| Action | Description |
|---|---|
| `getCommittee({ height? })` | Current or historical committee |
| `getDelegators({ validator })` | Delegators for a validator |
| `getStakingEarnings({ address })` | Staking earnings for an address |

### Metrics

| Action | Description |
|---|---|
| `getTransactionMetrics()` | Daily transaction counts |
| `getProgramMetrics()` | Program calls (last 7 days) |
| `getProgramMetricsByRange({ program, start, end })` | Program metrics over a custom range |
| `getApy()` | Current staking APY |
| `getValidatorApy()` | Per-validator APY |

### Supply & DeFi

| Action | Description |
|---|---|
| `getTotalSupply()` | Total ALEO supply |
| `getCirculatingSupply()` | Circulating ALEO supply |
| `getTvl()` | Total DeFi TVL |
| `getTokens()` | Token data |
| `getTokenDetails({ tokenId })` | Detail for a single token |

## Examples

### Read a mapping value

```ts
const value = await client.readMapping({
  program: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1...',
})
```

### Get block info

```ts
const height = await client.getBlockNumber()
const block = await client.getBlock({ height: Number(height) })
console.log(block.block_hash, block.header.metadata.timestamp)
```

### Query staking state

```ts
const committee = await client.getCommittee()
const delegators = await client.getDelegators({
  validator: 'aleo1validator...',
})
const earnings = await client.getStakingEarnings({
  address: 'aleo1...',
})
```
