# Viem Client Methods Reference

Complete reference of all viem client actions, organized by client type and category.
Source: viem v2.x documentation (https://viem.sh/docs)

---

## Public Client Actions

Created via `createPublicClient()`. These are read-only actions that interact with the blockchain.

### Block

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `getBlock` | Returns information about a block at a block number, hash, or tag | `blockNumber`, `blockHash`, `blockTag`, `includeTransactions` |
| `getBlockNumber` | Returns the number of the most recent block seen | `cacheTime`, `maxAge` |
| `getBlockTransactionCount` | Returns the number of transactions at a block number, hash, or tag | `blockNumber`, `blockHash`, `blockTag` |
| `watchBlockNumber` | Watches and returns incoming block numbers | `onBlockNumber`, `pollingInterval`, `emitOnBegin` |
| `watchBlocks` | Watches and returns information for incoming blocks | `onBlock`, `pollingInterval`, `includeTransactions`, `emitOnBegin`, `blockTag` |

### Transaction

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `call` | Executes a new message call (eth_call) | `account`, `to`, `data`, `value`, `gas`, `gasPrice`, `blockNumber`, `blockTag` |
| `getTransaction` | Returns information about a transaction given a hash or block identifier | `hash`, `blockHash`, `blockNumber`, `index` |
| `getTransactionConfirmations` | Returns the number of blocks passed since the transaction was processed | `hash`, `transactionReceipt` |
| `getTransactionReceipt` | Returns the transaction receipt given a transaction hash | `hash` |
| `waitForTransactionReceipt` | Waits for a transaction receipt to be available | `hash`, `confirmations`, `pollingInterval`, `timeout`, `onReplaced` |
| `getTransactionCount` | Returns the number of transactions an account has sent (nonce) | `address`, `blockNumber`, `blockTag` |
| `simulateBlocks` | Simulates a set of calls on block(s) | `blocks` (array of block overrides + calls) |
| `simulateCalls` | Simulates a set of calls on a single block | `calls`, `blockNumber`, `blockTag` |
| `createAccessList` | Creates an EIP-2930 access list for a transaction | `to`, `data`, `value`, `account`, `blockNumber`, `blockTag` |

### Account / Balance

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `getBalance` | Returns the balance of an address in wei | `address`, `blockNumber`, `blockTag` |
| `getProof` | Returns the account and storage values including the Merkle-proof | `address`, `storageKeys`, `blockNumber`, `blockTag` |

### Contract

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `readContract` | Calls a read-only function on a contract | `address`, `abi`, `functionName`, `args`, `blockNumber`, `blockTag` |
| `simulateContract` | Simulates and validates a contract interaction | `address`, `abi`, `functionName`, `args`, `account`, `value` |
| `estimateContractGas` | Estimates gas required for a contract write function call | `address`, `abi`, `functionName`, `args`, `account`, `value` |
| `multicall` | Batches up multiple functions on a contract in a single call | `contracts` (array of {address, abi, functionName, args}), `blockNumber`, `blockTag`, `allowFailure` |
| `getCode` | Retrieves the bytecode at an address | `address`, `blockNumber`, `blockTag` |
| `getStorageAt` | Returns the value from a storage slot at a given address | `address`, `slot`, `blockNumber`, `blockTag` |
| `getContractEvents` | Returns a list of event logs matching the provided parameters | `address`, `abi`, `eventName`, `args`, `fromBlock`, `toBlock` |
| `watchContractEvent` | Watches and returns emitted contract event logs | `address`, `abi`, `eventName`, `args`, `onLogs`, `pollingInterval` |

### Chain / Network

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `getChainId` | Returns the chain ID associated with the current network | _(none)_ |

### Fee / Gas

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `estimateGas` | Estimates the gas required for a transaction | `account`, `to`, `data`, `value`, `gas`, `gasPrice`, `maxFeePerGas`, `maxPriorityFeePerGas` |
| `estimateFeesPerGas` | Returns an estimate for fees per gas for the next block | `chain`, `type` (`legacy` or `eip1559`) |
| `estimateMaxPriorityFeePerGas` | Returns an estimate for the max priority fee per gas | _(none)_ |
| `getGasPrice` | Returns the current price of gas in wei | _(none)_ |
| `getBlobBaseFee` | Returns the current blob base fee in wei | _(none)_ |
| `getFeeHistory` | Returns a collection of historical gas information | `blockCount`, `rewardPercentiles`, `blockNumber`, `blockTag` |

### Log / Event

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `getLogs` | Returns a list of event logs matching the provided parameters | `address`, `event`, `args`, `fromBlock`, `toBlock`, `blockHash` |
| `watchEvent` | Watches and returns emitted event logs | `address`, `event`, `args`, `onLogs`, `pollingInterval` |

### Filter

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `createBlockFilter` | Creates a new block filter | _(none)_ |
| `createEventFilter` | Creates a new event filter | `address`, `event`, `args`, `fromBlock`, `toBlock` |
| `createPendingTransactionFilter` | Creates a new pending transaction filter | _(none)_ |
| `getFilterChanges` | Returns a list of logs or hashes based on a filter since last poll | `filter` |
| `getFilterLogs` | Returns a list of event logs since the filter was created | `filter` |
| `uninstallFilter` | Destroys a filter | `filter` |

### Pending Transactions

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `watchPendingTransactions` | Watches and returns pending transaction hashes | `onTransactions`, `pollingInterval` |

### Signature Verification

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `verifyMessage` | Verifies if a signed message was generated by the provided address | `address`, `message`, `signature` |
| `verifyTypedData` | Verifies a typed data signature | `address`, `domain`, `types`, `primaryType`, `message`, `signature` |
| `verifyHash` | Verifies if a signed hash was generated by the provided address | `address`, `hash`, `signature` |

### EIP-712 Domain

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `getEip712Domain` | Reads the EIP-712 domain from a contract | `address` |

### ENS (Extension)

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `getEnsAddress` | Gets address for an ENS name | `name`, `coinType`, `universalResolverAddress` |
| `getEnsName` | Gets primary name for specified address | `address`, `universalResolverAddress` |
| `getEnsAvatar` | Gets the avatar of an ENS name | `name`, `universalResolverAddress` |
| `getEnsResolver` | Gets resolver for an ENS name | `name`, `universalResolverAddress` |
| `getEnsText` | Gets a text record for specified ENS name | `name`, `key`, `universalResolverAddress` |

---

## Wallet Client Actions

Created via `createWalletClient()`. These actions require a signer/account and can modify state.

### Account Management

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `getAddresses` | Returns a list of addresses owned by the wallet or client | _(none)_ |
| `requestAddresses` | Requests a list of accounts managed by a wallet (triggers connect popup) | _(none)_ |

### Transaction

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `prepareTransactionRequest` | Prepares a transaction request for signing (fills gas, nonce, etc.) | `account`, `to`, `data`, `value`, `gas`, `gasPrice`, `maxFeePerGas`, `maxPriorityFeePerGas`, `nonce`, `chain` |
| `sendTransaction` | Creates, signs, and sends a new transaction to the network | `account`, `to`, `data`, `value`, `gas`, `gasPrice`, `maxFeePerGas`, `maxPriorityFeePerGas`, `nonce`, `chain` |
| `sendTransactionSync` | Creates, signs, and sends a transaction synchronously (returns receipt) | Same as `sendTransaction` |
| `sendRawTransaction` | Sends a signed (serialized) transaction to the network | `serializedTransaction` |
| `sendRawTransactionSync` | Sends a signed transaction to the network synchronously | `serializedTransaction` |
| `signTransaction` | Signs a transaction without sending it | `account`, `to`, `data`, `value`, `gas`, `gasPrice`, `maxFeePerGas`, `maxPriorityFeePerGas`, `nonce`, `chain` |

### Signing

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `signMessage` | Signs a message with the account's private key (EIP-191) | `account`, `message` |
| `signTypedData` | Signs EIP-712 typed data with the account's private key | `account`, `domain`, `types`, `primaryType`, `message` |

### Chain Management

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `addChain` | Adds an EVM chain to the wallet | `chain` ({id, name, nativeCurrency, rpcUrls, blockExplorers}) |
| `switchChain` | Switches the target chain in a wallet | `id` |

### Permissions

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `getPermissions` | Gets the wallet's current permissions | _(none)_ |
| `requestPermissions` | Requests permissions for a wallet | `eth_accounts` (permission object) |

### EIP-5792 Batch Calls

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `sendCalls` | Signs and broadcasts a batch of calls to the network | `account`, `calls` (array of {to, data, value}), `capabilities` |
| `sendCallsSync` | Signs and broadcasts a batch of calls, waits for inclusion | Same as `sendCalls` |
| `getCallsStatus` | Returns the status of a call batch | `id` |
| `showCallsStatus` | Requests the wallet to show information about a call batch | `id` |
| `waitForCallsStatus` | Waits for a call batch to be confirmed and included on a block | `id`, `pollingInterval`, `timeout` |
| `getCapabilities` | Extracts capabilities that a connected wallet supports (EIP-5792) | `account` |

### Asset Management

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `watchAsset` | Requests that the user tracks a token in their wallet | `type` (`ERC20`), `options` ({address, symbol, decimals, image}) |

### Contract (via Wallet)

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `deployContract` | Deploys a contract to the network given bytecode and constructor arguments | `abi`, `bytecode`, `args`, `account`, `value`, `gas` |
| `writeContract` | Executes a write function on a contract | `address`, `abi`, `functionName`, `args`, `account`, `value`, `gas` |
| `writeContractSync` | Executes a write function on a contract synchronously | Same as `writeContract` |

---

## Test Client Actions

Created via `createTestClient()`. These actions are only available on test nodes (Hardhat, Anvil, Ganache).

### Mining

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `mine` | Mines a specified number of blocks | `blocks`, `interval` (seconds between blocks) |
| `getAutomine` | Returns the automatic mining status of the node | _(none)_ |
| `setAutomine` | Enables or disables automatic mining of new blocks | `enabled` (boolean) |
| `setIntervalMining` | Sets the automatic mining interval (in seconds) | `interval` |

### Account Manipulation

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `setBalance` | Modifies the balance of an account | `address`, `value` (wei) |
| `setNonce` | Modifies (overrides) the nonce of an account | `address`, `nonce` |
| `setCode` | Modifies the bytecode stored at an account's address | `address`, `bytecode` |
| `setStorageAt` | Writes to a slot of an account's storage | `address`, `index` (slot), `value` |
| `impersonateAccount` | Impersonates an account or contract address | `address` |
| `stopImpersonatingAccount` | Stops impersonating an account | `address` |

### Block Manipulation

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `setBlockGasLimit` | Sets the block's gas limit | `gasLimit` |
| `setBlockTimestampInterval` | Sets the block's timestamp interval | `interval` (seconds) |
| `removeBlockTimestampInterval` | Removes the block timestamp interval if it exists | _(none)_ |
| `setNextBlockBaseFeePerGas` | Sets the next block's base fee per gas | `baseFeePerGas` |
| `setNextBlockTimestamp` | Sets the next block's timestamp | `timestamp` |
| `increaseTime` | Jumps forward in time by the given amount | `seconds` |
| `setCoinbase` | Sets the coinbase address to be used in new blocks | `address` |

### Network / Node

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `setMinGasPrice` | Changes the minimum gas price accepted by the network | `gasPrice` (wei) |
| `setRpcUrl` | Sets the backend RPC URL | `url` |
| `setLoggingEnabled` | Enables or disables logging on the test node | `enabled` (boolean) |
| `reset` | Resets the fork back to its original state | `jsonRpcUrl`, `blockNumber` |

### State Management

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `snapshot` | Snapshots the state of the blockchain at the current block | _(none)_ — returns snapshot id |
| `revert` | Reverts the state of the blockchain to a previous snapshot | `id` (snapshot id) |
| `dumpState` | Serializes the current state into a savable data blob | _(none)_ |
| `loadState` | Adds state previously dumped to the current chain | `state` (hex-encoded state blob) |

### Transaction Pool

| Method | Description | Key Parameters |
|--------|-------------|----------------|
| `dropTransaction` | Removes a transaction from the mempool | `hash` |
| `sendUnsignedTransaction` | Executes a transaction regardless of the signature | `from`, `to`, `data`, `value`, `gas` |
| `getTxpoolContent` | Returns details of all transactions currently pending | _(none)_ |
| `getTxpoolStatus` | Returns a summary of all pending transactions | _(none)_ |
| `inspectTxpool` | Returns a text summary of all pending transactions | _(none)_ |

---

## Summary Count

| Client | Category Count | Method Count |
|--------|---------------|--------------|
| **Public Client** | 10 categories | 40 methods |
| **Wallet Client** | 7 categories | 21 methods |
| **Test Client** | 5 categories | 22 methods |
| **Total** | — | **83 methods** |

---

## Notes for aleo-viem Design

- **Public Client** is the largest surface area — most methods map to JSON-RPC calls
- **ENS actions** are added via `publicClient.extend(ensActions)` — same pattern we use for Aleo-specific actions
- **Contract actions** span both public (read) and wallet (write) clients — aleo-viem can follow this same split
- **EIP-5792 batch calls** (`sendCalls`, `getCallsStatus`, etc.) are newer wallet-level batch primitives
- **Test Client** maps to Hardhat/Anvil-specific RPC methods — equivalent for Aleo would be snarkOS devnet manipulation
- **Watcher methods** (`watchBlockNumber`, `watchBlocks`, `watchEvent`, `watchContractEvent`, `watchPendingTransactions`) all follow the same pattern: callback + pollingInterval + optional emitOnBegin
- **Sync variants** (`sendTransactionSync`, `writeContractSync`, `sendRawTransactionSync`, `sendCallsSync`) are newer additions that return receipts directly instead of just tx hashes
