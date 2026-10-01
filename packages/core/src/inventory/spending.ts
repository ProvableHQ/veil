import type { Client } from '../clients/createClient.js'
import type { TransactionInput } from '../types/inputRequest.js'
import type { ProvingProgressHandler } from '../types/proving.js'
import type { Transaction } from '../types/transaction.js'
import { requestRecords } from '../actions/wallet/requestRecords.js'
import { parseRecord } from '../utils/records.js'
import { inventoryRecordId, management, scopeOf } from './internal.js'

/** Builds an internal client view that avoids recursive reservation acquisition. @internal */
export function withoutManagement(client: Client): Client {
  return Object.assign(Object.create(client), { recordManagement: undefined }) as Client
}

/** Reads the public base and priority fees in microcredits; rejects an unverifiable fee. @internal */
export function transactionFee(tx: Transaction): bigint {
  if (!tx.fee) return 0n
  const values = tx.fee.transition.inputs?.slice(0, 2).map((input) => input.value)
  if (values?.length !== 2 || values.some((value) => !/^\d+u64$/.test(value ?? ''))) {
    throw new Error('Cannot verify transaction fee before broadcast')
  }
  return values.reduce((sum, value) => sum + BigInt(value!.slice(0, -3)), 0n)
}

/** Reserves explicit inputs and persists each awaited proving boundary before allowing submission. @internal */
export async function manageRecordSpend<T>(client: Client, params: {
  program: string; function: string; inputs: TransactionInput[]; privateFee?: boolean
  onProgress?: ProvingProgressHandler
}, submit: (onProgress: ProvingProgressHandler) => Promise<T>): Promise<T> {
  const config = management(client)!
  if (params.privateFee) throw new Error('Managed records require public fees or FeeMaster; private fee selection is not coordinated')
  const scope = scopeOf(client)
  if (client.account?.type === 'rpc' && config.maxFeeMicrocredits !== undefined) throw new Error('Wallet accounts cannot enforce a fee ceiling before submission')
  const ids: string[] = []
  for (const input of params.inputs) {
    if (typeof input === 'object' && input.type === 'record') {
      if (!input.uid) throw new Error('Managed wallet spending requires a pinned record uid')
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
  const entry = await config.store.acquire({ scope, records: ids, program: params.program,
    function: params.function, status: 'reserved', createdAt: Date.now(), accountType: client.account?.type === 'local' ? 'local' : 'rpc' })
  if (!entry) throw new Error('Record inventory changed: an input is already reserved or spent')
  let prepared = false
  let submitted = false
  try {
    return await submit(async (event) => {
      // A changed account/network invalidates the reservation namespace.
      if (scopeOf(client) !== scope) throw new Error('Account or chain changed during record spending')
      if (event.type === 'transaction-prepared') {
        const fee = transactionFee(event.transaction)
        if (config.maxFeeMicrocredits !== undefined && fee > config.maxFeeMicrocredits) {
          throw new Error('Proved transaction exceeds maxFeeMicrocredits')
        }
        await config.store.update(scope, entry.id, { status: 'prepared', transactionId: event.transactionId,
          transaction: event.transaction, feeMicrocredits: fee.toString() })
        prepared = true
      } else if (event.type === 'transaction-submitted') {
        submitted = true
        await config.store.update(scope, entry.id, { status: 'submitted', transactionId: event.transactionId })
      } else if (event.type === 'transaction-confirmed') {
        await config.store.update(scope, entry.id, { status: 'confirmed', transactionId: event.transactionId, transaction: undefined })
      }
      await params.onProgress?.(event)
    })
  } catch (error) {
    // Local build paths never broadcast before transaction-prepared. Wallets may
    // have submitted even if their response was lost, so their reservations remain.
    if (!prepared && !submitted && client.account?.type === 'local') {
      await config.store.update(scope, entry.id, { status: 'cancelled' })
    }
    throw error
  }
}
