---
sidebar_position: 2
---

# Types

Reference for the object types `@provablehq/veil-core` returns from chain
reads and record scans. For the account and client types (`LocalAccount`,
`RpcAccount`, `PublicClient`, `WalletClient`), see
[Wallet Client](/clients/wallet-client) and
[Public Client](/clients/public-client); for the transport types, see
[Transports](/api/transports).

## Wire format

Block, transaction, and record types mirror the Provable REST API's JSON
responses field for field. Field names stay `snake_case` — `block_hash`,
`previous_state_root`, `finalize_root` — rather than being converted to
`camelCase`, so a value copied from a raw HTTP response or from
[the Aleo explorer](https://explorer.provable.com) matches the property name
on the parsed object exactly. Types that originate from the wallet-facing
API instead (`OwnedRecord`, `TransactionStatusResponse`) use `camelCase`,
matching the Provable wallet standard rather than the node's REST format.

## Numeric widths

The rule across `@provablehq/veil-core`: `number` represents a u64 or
smaller on-chain integer, `bigint` represents a u128 or larger one. Two
kinds of exception exist:

- **Widened for parity with viem.** `getBalance` and `getBlockNumber` return
  `bigint` even though the underlying values are a u64 and a u32
  respectively, matching viem's `getBalance`/`getBlockNumber` return types.
  Convert with `Number()` before passing a block height into an action that
  takes one (`Number(await client.getBlockNumber())`).
- **Delivered as a string on the wire.** `Metadata.cumulative_weight` and
  `Metadata.cumulative_proof_target` are u128 values, but JSON numbers
  cannot losslessly represent a u128, so the node sends them as decimal
  strings. Wrap with `BigInt(...)` to use them as numbers.

## Transaction status

`walletClient.transactionStatus` and the block-level `ConfirmedTransaction.status`
field both report a transaction's state as one of four strings:

| Status | Meaning |
| --- | --- |
| `'accepted'` | Confirmed in a block; the transaction succeeded. |
| `'rejected'` | Confirmed in a block, but the transaction failed on-chain (e.g. an assertion failed). |
| `'pending'` | Present in the mempool, not yet confirmed. |
| `'not_found'` | Absent from both the confirmed and unconfirmed pools — never submitted, dropped, or expired. |

Veil never uses `'finalized'` for this state; Aleo's finalize step is a
distinct concept (the on-chain execution of a transaction's mapping writes)
from confirmation, and the status strings above are the complete set a
caller needs to branch on. See
[Transaction Lifecycle](/guides/transaction-lifecycle) for polling a
transaction through these states.

## Block types

```ts
import type { Block, Header, Metadata, Ratification, Solutions, Solution, PartialSolution, Finalize, ConfirmedTransaction } from '@provablehq/veil-core'
```

`Block` is what `client.getBlock({ height })` and `client.getBlockNumber()`
consumers see: the raw shape from the node's `GET /{network}/block/{heightOrHash}`
endpoint.

**`Block`**

| Field | Type | Description |
| --- | --- | --- |
| `block_hash` | `string` | Hash of this block. |
| `previous_hash` | `string` | Hash of the preceding block. |
| `header` | `Header` | Merkle roots and metadata for the block. |
| `authority` | `Record<string, unknown>` | Beacon or quorum authority for the block. Opaque — shape varies by consensus variant. |
| `transactions` | `ConfirmedTransaction[]` (optional) | Transactions confirmed in this block. |
| `ratifications` | `Ratification[]` | Protocol-level credit movements (block and puzzle rewards). |
| `solutions` | `Solutions` | Puzzle solutions section. |
| `aborted_solution_ids` | `string[]` | Solution ids aborted during this block. |
| `aborted_transaction_ids` | `string[]` | Transaction ids aborted during this block. |

**`Header`**

| Field | Type | Description |
| --- | --- | --- |
| `previous_state_root` | `string` | State root before this block. |
| `transactions_root` | `string` | Merkle root over the block's transactions. |
| `finalize_root` | `string` | Merkle root over finalize operations. |
| `ratifications_root` | `string` | Merkle root over ratifications. |
| `solutions_root` | `string` | Merkle root over puzzle solutions. |
| `subdag_root` | `string` | Merkle root over the consensus subdag. |
| `metadata` | `Metadata` | Network id, height, round, targets, and timestamps. |

**`Metadata`**

| Field | Type | Description |
| --- | --- | --- |
| `network` | `number` | u16 — network id. |
| `round` | `number` | u64 — consensus round. |
| `height` | `number` | u32 — block height. |
| `coinbase_target` | `number` | u64 — coinbase puzzle target. |
| `proof_target` | `number` | u64 — prover solution target. |
| `last_coinbase_target` | `number` | u64 — `coinbase_target` of the most recent coinbase-producing block. |
| `last_coinbase_timestamp` | `number` | i64 — unix seconds of the most recent coinbase-producing block. |
| `timestamp` | `number` | i64 — unix seconds this block was produced. |
| `cumulative_weight` | `string` | u128 — cumulative consensus weight, delivered as a decimal string; wrap with `BigInt(...)`. |
| `cumulative_proof_target` | `string` | u128 — cumulative proof target, delivered as a decimal string for the same reason. |

**`Ratification`**, **`PartialSolution`**, **`Solution`**, **`Solutions`**

| Type | Field | Type | Description |
| --- | --- | --- | --- |
| `Ratification` | `type` | `string` | Ratification kind, e.g. `'block_reward'`, `'puzzle_reward'`. |
| `Ratification` | `amount` | `number` | u64 — microcredits moved by this ratification. |
| `PartialSolution` | `solution_id` | `string` | Solution identifier. |
| `PartialSolution` | `epoch_hash` | `string` | Epoch hash the solution was computed against. |
| `PartialSolution` | `address` | `string` | Prover's address. |
| `PartialSolution` | `counter` | `number` | u64 — puzzle nonce. |
| `Solution` | `partial_solution` | `PartialSolution` | The prover-supplied part of the solution. |
| `Solution` | `target` | `number` | u64 — solution target. |
| `Solutions` | `version` | `number` | u16 — solutions format version. |
| `Solutions` | `solutions` | `Solution[]` (optional) | Absent when the block has no puzzle solutions. |

**`Finalize`**

| Field | Type | Description |
| --- | --- | --- |
| `type` | `string` | Operation kind, e.g. `'update_key_value'`, `'insert_key_value'`. |
| `mapping_id` | `string` | Mapping the operation touched. |
| `key_id` | `string` | Id of the affected key. |
| `value_id` | `string` | Id of the resulting value. |

**`ConfirmedTransaction`**

| Field | Type | Description |
| --- | --- | --- |
| `status` | `string` | `'accepted'` or `'rejected'`. See [Transaction status](#transaction-status). |
| `type` | `string` | `'execute'`, `'deploy'`, or `'fee'`. |
| `index` | `number` | u32 — position within the block. |
| `transaction` | `Record<string, unknown>` | The raw transaction; parse it as a `Transaction` (below) for a typed view. Left widened here to avoid a circular import. |
| `finalize` | `Finalize[]` | Mapping changes the transaction caused. |

## Transaction types

```ts
import type { Transaction, Transition, Input, Output, Execution, FeeExecution, Deployment, VerifyingKey, Owner } from '@provablehq/veil-core'
```

`Transaction` is what `client.getTransaction({ id })` returns — the shape
from the node's `GET /{network}/transaction/{id}` endpoint. `execution` is
present on execute transactions, `deployment` on deploy transactions,
matching `type`.

**`Transaction`**

| Field | Type | Description |
| --- | --- | --- |
| `type` | `string` | `'execute'`, `'deploy'`, or `'fee'`. |
| `id` | `string` | On-chain transaction id (`at1...`). |
| `execution` | `Execution` (optional) | Present on execute transactions. |
| `deployment` | `Deployment` (optional) | Present on deploy transactions. |
| `fee` | `FeeExecution` | The credits.aleo fee transition paid for this transaction. |
| `owner` | `Owner` (optional) | Deployer signature; present on deploy transactions. |

**`Execution`** / **`FeeExecution`**

| Type | Field | Type | Description |
| --- | --- | --- | --- |
| `Execution` | `transitions` | `Transition[]` | Program-function calls made by this execution. |
| `Execution` | `global_state_root` | `string` | State root the proof was built against. |
| `Execution` | `proof` | `string` | The execution proof. |
| `FeeExecution` | `transition` | `Transition` | The single credits.aleo fee transition. |
| `FeeExecution` | `global_state_root` | `string` | State root the fee proof was built against. |
| `FeeExecution` | `proof` | `string` | The fee proof. |

**`Transition`**

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Transition id (`au1...`). |
| `program` | `string` | Program id called. |
| `function` | `string` | Function/transition name called. |
| `inputs` | `Input[]` (optional) | Transition inputs. |
| `outputs` | `Output[]` (optional) | Transition outputs. |
| `tpk` | `string` | Transition public key. |
| `tcm` | `string` | Transition commitment. |
| `scm` | `string` (optional) | Signer commitment. Present on the wire; not carried by every SDK's transition type. |

**`Input`** / **`Output`**

| Type | Field | Type | Description |
| --- | --- | --- | --- |
| `Input` | `type` | `string` | Visibility kind: `'public'`, `'private'`, `'record'`, or `'external_record'`. |
| `Input` | `id` | `string` | Input id. |
| `Input` | `tag` | `string` (optional) | Record tag; present on record inputs. |
| `Input` | `value` | `string` (optional) | Plaintext or ciphertext, depending on visibility; absent on record inputs. |
| `Output` | `type` | `string` | Visibility kind: `'public'`, `'private'`, `'record'`, or `'future'`. |
| `Output` | `id` | `string` | Output id. |
| `Output` | `checksum` | `string` (optional) | Output checksum. |
| `Output` | `value` | `string` (optional) | Plaintext or ciphertext value, depending on visibility. |

**`Deployment`** / **`VerifyingKey`** / **`Owner`**

| Type | Field | Type | Description |
| --- | --- | --- | --- |
| `Deployment` | `edition` | `number` | u16 — deployment edition. |
| `Deployment` | `program` | `string` | Aleo program source. |
| `Deployment` | `verifying_keys` | `VerifyingKey[]` | One entry per program function. |
| `VerifyingKey` | *(tuple)* | `[string, [string, string]]` | `[function_name, [vk_hash, certificate]]`. |
| `Owner` | `address` | `string` | Deployer's address. |
| `Owner` | `signature` | `string` | Deployer's signature over the deployment. |

## Record types

```ts
import type { OwnedRecord, OwnedRecordEncrypted, RecordView, RecordStatusFilter, RequestRecordsParameters } from '@provablehq/veil-core'
```

`OwnedRecord` and `OwnedRecordEncrypted` are `camelCase`, following the
wallet-facing API rather than the node's REST wire format — a decrypted
record never goes over the node's REST endpoints. See
[Working with Records](/guides/working-with-records) for the scanning flow
that produces these.

**`OwnedRecordEncrypted`**

| Field | Type | Description |
| --- | --- | --- |
| `programName` | `string` | Program the record belongs to. |
| `tag` | `string` | Record tag. |
| `blockHeight` | `number` (optional) | Height the record was created at. |
| `blockTimestamp` | `number` (optional) | Unix seconds the record was created at. |
| `commitment` | `string` (optional) | Record commitment. |
| `functionName` | `string` (optional) | Function that produced the record. |
| `outputIndex` | `number` (optional) | Position among the producing transition's outputs. |
| `owner` | `string` (optional) | Owner address. |
| `recordCiphertext` | `string` (optional) | Encrypted record ciphertext. |
| `recordName` | `string` (optional) | Record type name. |
| `sender` | `string` (optional) | Sender address. |
| `spent` | `boolean` (optional) | Whether the record has been spent. |
| `transactionId` | `string` (optional) | Producing transaction id. |
| `transitionId` | `string` (optional) | Producing transition id. |
| `transactionIndex` | `number` (optional) | Transaction's position within its block. |
| `transitionIndex` | `number` (optional) | Transition's position within its transaction. |
| `uid` | `string` (optional) | Opaque per-connection handle from a privacy-preserving wallet. Pass back as an `InputRequest`'s `uid` to spend exactly this record. Absent from wallets that predate the privacy feature. |
| `recordView` | `RecordView` (optional) | Granted plaintext fields when the wallet withholds full plaintext under a `recordAccess` grant. |

**`OwnedRecord`** extends `OwnedRecordEncrypted` with:

| Field | Type | Description |
| --- | --- | --- |
| `recordPlaintext` | `string` | Decrypted record plaintext. |

**`RecordView`**

| Field | Type | Description |
| --- | --- | --- |
| `fields` | `Record<string, string>` | Granted field key to Aleo-encoded value string. Keys may be a record-body field name, a dotted struct path (`'data.amount'`), or a `$`-prefixed metadata token (`'$commitment'`). |

**`RecordStatusFilter`** is `'all' | 'spent' | 'unspent'`.

**`RequestRecordsParameters`** — parameters for `requestRecords`, scoping the scan to one program's records.

| Field | Type | Description |
| --- | --- | --- |
| `program` | `string` | Program whose records to scan. |
| `includePlaintext` | `boolean` (optional) | Whether to include plaintext on each record. Defaults to `true`. |
| `statusFilter` | `RecordStatusFilter` (optional) | Filter by spent status. Defaults to `'all'`. |

### Record Scanning Service (RSS) types

```ts
import type { RecordFilter, ResponseFilter, OwnedRecordsRequest } from '@provablehq/veil-core'
```

These shape requests to a hosted [Record Scanning Service](/guides/working-with-records) scanner.

| Type | Field | Type | Description |
| --- | --- | --- | --- |
| `RecordFilter` | `commitments` | `string[]` (optional) | Restrict the scan to these commitments. |
| `RecordFilter` | `start` / `end` | `number` (optional) | Lower/upper bound of the block-height range to scan. |
| `RecordFilter` | `programs` | `string[]` (optional) | Restrict the scan to these programs. |
| `RecordFilter` | `records` | `string[]` (optional) | Restrict the scan to these record type names. |
| `RecordFilter` | `functions` | `string[]` (optional) | Restrict the scan to records produced by these functions. |
| `RecordFilter` | `response` | `ResponseFilter` (optional) | Field-selection mask applied to each returned record. |
| `ResponseFilter` | *(any field)* | `boolean` (optional) | Set a field true to include it on each returned record, e.g. `commitment`, `owner`, `blockHeight`. |
| `OwnedRecordsRequest` | `uuid` | `string` | Scan session identifier issued by the service. |
| `OwnedRecordsRequest` | `unspent` | `boolean` (optional) | When true, return only unspent records. |
| `OwnedRecordsRequest` | `filter` | `RecordFilter` (optional) | Narrows the scan as described above. |
