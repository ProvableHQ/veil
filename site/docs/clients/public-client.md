---
sidebar_position: 1
---

# Public Client

The public client provides read-only access to the Aleo network. No wallet or account needed.

## Create a Public Client

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

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
| `getBlocks({ start, end })` | Range of blocks (max 50) |
| `getBlockTransactions({ height })` | Transactions in a block |
| `getBlockSummary()` | Summary of latest 1000 blocks |
| `getStateRoot({ height? })` | State root at height |
| `getStatePath({ commitment })` | State path for a commitment |

### Transactions

| Action | Description |
|---|---|
| `getTransaction({ id })` | Transaction by ID |
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
| `getCode({ program })` | Program source code |
| `readContract({ program, mapping, key })` | Read a mapping value |
| `readMapping({ program, mapping, key })` | Alias for `readContract` |
| `getMappingNames({ program })` | List mapping names for a program |
| `getDeploymentTransaction({ program })` | Deployment transaction for a program |
| `getProgramCalls({ program })` | Latest 1000 calls to a program |

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
| `getApy()` | Current staking APY |
| `getValidatorApy()` | Per-validator APY |

### Supply & DeFi

| Action | Description |
|---|---|
| `getTotalSupply()` | Total ALEO supply |
| `getCirculatingSupply()` | Circulating ALEO supply |
| `getTvl()` | Total DeFi TVL |
| `getTokens()` | Token data |

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
