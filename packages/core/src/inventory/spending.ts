import { RecordReservationConflictError } from '../errors/errors.js'
import type { Client } from '../clients/createClient.js'
import type { TransactionInput } from '../types/inputRequest.js'
import type { ProvingProgressHandler } from '../types/proving.js'
import type { InventoryRecord, RecordSpend } from './types.js'
import type { OwnedRecord } from '../types/records.js'
import { getRecordInventory } from '../actions/records/getRecordInventory.js'
import type { Transaction } from '../types/transaction.js'
import { requestRecords } from '../actions/wallet/requestRecords.js'
import { parseRecord } from '../utils/records.js'
import { inventoryRecordId, management, reservedRecordIds, scopeOf } from './internal.js'

/** Builds an internal client view that avoids recursive reservation acquisition. @internal */
export function withoutManagement(client: Client, feeRecord?: string): Client {
  // Preserve the original account, transport, and prover without mutating the
  // caller's client; only the nested action skips reservation acquisition.
  const proving = feeRecord && client.proving ? { ...client.proving,
    buildTransaction: client.proving.buildTransaction && ((options) => client.proving!.buildTransaction!({ ...options, feeRecord })),
    execute: client.proving.execute && ((options) => client.proving!.execute!({ ...options, feeRecord })),
  } satisfies NonNullable<Client['proving']> : client.proving
  return Object.assign(Object.create(client), { recordManagement: undefined, proving }) as Client
}

/** Reads base and priority fees in microcredits for public or private payment; rejects an unverifiable fee. @internal */
export function transactionFee(tx: Transaction): bigint {
  if (!tx.fee) return 0n
  // Both fee functions expose the amounts publicly. fee_private puts its
  // consumed credits record before those amounts.
  const offset = tx.fee.transition.function === 'fee_private' ? 1 : 0
  const values = tx.fee.transition.inputs?.slice(offset, offset + 2).map((input) => input.value)
  if (values?.length !== 2 || values.some((value) => !/^\d+u64$/.test(value ?? ''))) {
    throw new Error('Cannot verify transaction fee before broadcast')
  }
  return values.reduce((sum, value) => sum + BigInt(value!.slice(0, -3)), 0n)
}

/** Reserves explicit inputs and persists each awaited proving boundary before allowing submission. @internal */
export async function manageRecordSpend<T>(client: Client, params: {
  program: string; function: string; inputs: TransactionInput[]; privateFee?: boolean; feeRecord?: string; fee?: bigint; programSource?: string
  imports?: string[] | Record<string, string>
  onProgress?: ProvingProgressHandler
}, submit: (onProgress: ProvingProgressHandler, feeRecord?: string) => Promise<T>): Promise<T> {
  const config = management(client)!
  if (params.privateFee && client.account?.type !== 'local') {
    throw new Error('Managed private fees require a local signer; this wallet protocol cannot pin a fee record')
  }
  const scope = scopeOf(client)
  if (client.account?.type === 'rpc' && config.maxFeeMicrocredits !== undefined) throw new Error('Wallet accounts cannot enforce a fee ceiling before submission')
  // Normalize wallet-selected and plaintext inputs to stable record nonces so
  // clients using different scanner or wallet representations share reservations.
  const ids: string[] = []
  for (const input of params.inputs) {
    if (typeof input === 'object' && input.type === 'record') {
      if (!input.uid) throw new Error('Managed wallet spending requires a pinned record uid')
      // Resolve the pinned uid again rather than letting the wallet select a
      // different record after the reservation has been acquired.
      const records = await requestRecords(client, { program: input.program, statusFilter: 'unspent' })
      const record = records.find((record) => record.uid === input.uid)
      if (!record) throw new Error('Pinned wallet record is no longer available')
      ids.push(inventoryRecordId(record))
    } else if (typeof input === 'string' && input.trim().startsWith('{') && input.includes('_nonce')) {
      const record = parseRecord(input)
      if (record.owner !== client.account?.address) throw new Error('Cannot reserve another account’s record')
      ids.push(record.nonce)
    } else if (typeof input === 'string' && input.startsWith('record1')) {
      throw new Error('Managed spending requires a record nonce; ciphertext alone is insufficient')
    }
  }
  if (new Set(ids).size !== ids.length) throw new Error('A transaction cannot spend the same record twice')
  // Attribute routed joins to the underlying token for per-asset maintenance
  // cooldowns; the journal still records the actual router call separately.
  const assetProgram = config.joinAsset?.program === params.program ? config.joinAsset.assetProgram : config.tokenJoin && config.tokenJoin.program === params.program && /^join_\d+$/.test(params.function) && Array.isArray(params.imports)
    ? params.imports[0] : undefined
  let feeRecord: InventoryRecord | undefined
  let entry: RecordSpend | undefined
  // Include the fee record in the same atomic acquisition as the execution
  // inputs. Try another eligible fee record if a competing writer reserved it.
  const acquire = (fee?: InventoryRecord) => config.store.acquire({ scope, records: fee ? [...ids, fee.id] : ids,
    ...(fee ? { feeRecordId: fee.id } : {}), program: params.program, ...(assetProgram ? { assetProgram } : {}),
    function: params.function, status: 'reserved', createdAt: Date.now(), accountType: client.account?.type === 'local' ? 'local' : 'rpc' })
  if (params.privateFee) {
    const estimate = client.proving?.estimateExecutionFee
    if (!estimate) throw new Error('Managed private fees require a prover with estimateExecutionFee and pinned feeRecord support')
    const base = await estimate({ programName: params.program, functionName: params.function, programSource: params.programSource, imports: params.imports })
    const priority = params.fee ?? 0n
    if (typeof base !== 'bigint' || base < 0n || priority < 0n) throw new Error('Invalid private fee estimate or priority fee')
    const required = base + priority
    if (config.maxFeeMicrocredits !== undefined && required > config.maxFeeMicrocredits) throw new Error('Estimated transaction exceeds maxFeeMicrocredits')
    const inventory = await getRecordInventory(client, { asset: { program: 'credits.aleo' } })
    // A supplied record is a preference, never permission to reuse a reserved
    // input. Resolve it against the current scan and use the scanner plaintext.
    const preferred = params.feeRecord ? parseRecord(params.feeRecord).nonce : undefined
    const candidates = inventory.available.filter(record => !ids.includes(record.id) && record.amount >= required &&
      !!(record.record as Partial<OwnedRecord>).recordPlaintext && /^\d+field$/.test(record.record.tag ?? ''))
      .sort((a, b) => a.id === preferred ? -1 : b.id === preferred ? 1 : a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : a.id.localeCompare(b.id))
    if (scopeOf(client) !== scope) throw new Error('Account or chain changed during private fee selection')
    for (const candidate of candidates) {
      entry = await acquire(candidate)
      if (entry) { feeRecord = candidate; break }
      // A fixed execution input can also lose this atomic acquisition. Report
      // that separately so callers never treat exhausted fee records as a reason
      // to rebuild an execution with another token record.
      const held = await reservedRecordIds(client)
      const conflicting = ids.filter(id => held.has(id))
      if (conflicting.length) throw new RecordReservationConflictError(conflicting)
    }
    if (!entry) throw new Error('No available credits record covers the private fee separately from the transaction inputs; refresh records or fund private credits')
  } else {
    entry = await acquire()
  }
  if (!entry) throw new RecordReservationConflictError(ids)
  let prepared = false
  let submitted = false
  try {
    return await submit(async (event) => {
      // A changed account/network invalidates the reservation namespace.
      if (scopeOf(client) !== scope) throw new Error('Account or chain changed during record spending')
      if (event.type === 'transaction-prepared') {
        // Enforce the proved fee and save the exact transaction before allowing
        // broadcast, so recovery can resend it without constructing a second spend.
        // Verify the prover honored the pinned record before saving a transaction
        // that recovery could broadcast. Tags identify the consumed scanner record.
        const feeTransition = event.transaction.fee?.transition
        if (feeRecord && (feeTransition?.program !== 'credits.aleo' || feeTransition.function !== 'fee_private' ||
          feeTransition.inputs?.[0]?.type !== 'record' || feeTransition.inputs[0].tag !== feeRecord.record.tag)) {
          throw new Error('Prover did not spend the reserved private fee record')
        }
        const fee = transactionFee(event.transaction)
        if (feeRecord && fee > feeRecord.amount) throw new Error('Private fee exceeds the reserved credits record balance')
        if (config.maxFeeMicrocredits !== undefined && fee > config.maxFeeMicrocredits) {
          throw new Error('Proved transaction exceeds maxFeeMicrocredits')
        }
        await config.store.update(scope, entry.id, { status: 'prepared', transactionId: event.transactionId,
          transaction: event.transaction, feeMicrocredits: fee.toString() })
        prepared = true
      } else if (event.type === 'transaction-submitted') {
        // Mark submission before awaiting storage; a storage failure must not
        // release inputs that may already have been accepted by the network.
        submitted = true
        await config.store.update(scope, entry.id, { status: 'submitted', transactionId: event.transactionId })
      } else if (event.type === 'transaction-confirmed') {
        await config.store.update(scope, entry.id, { status: 'confirmed', transactionId: event.transactionId, transaction: undefined })
      }
      // Update the journal first, then await the caller's own checkpoint handler.
      await params.onProgress?.(event)
    }, feeRecord ? (feeRecord.record as OwnedRecord).recordPlaintext : undefined)
  } catch (error) {
    // Local build paths never broadcast before transaction-prepared. Wallets may
    // have submitted even if their response was lost, so their reservations remain.
    if (!prepared && !submitted && client.account?.type === 'local') {
      await config.store.update(scope, entry.id, { status: 'cancelled' })
    }
    // A nested action or caller checkpoint may throw its own conflict after
    // this execution acquired inputs. It must not authorize retrying this spend.
    if (error instanceof RecordReservationConflictError) {
      throw new Error('Record spending failed after acquiring inputs', { cause: error })
    }
    throw error
  }
}
