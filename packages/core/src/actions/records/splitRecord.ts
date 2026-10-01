import type { Client } from '../../clients/createClient.js'
import type { InventoryRecord, RecordAsset } from '../../inventory/types.js'
import type { ProvingProgressHandler } from '../../types/proving.js'
import { writeContract } from '../wallet/writeContract.js'
import { amountWidth, decodeRecord, recordInput, splitDeduction, validateAsset } from './internal.js'

/**
 * Supplies an owned record for a native split.
 * @property asset Program and supported standard.
 * @property record Source record from getRecordInventory.
 * @property amount Positive first output in integer base units (u64 credits, u128 tokens).
 * @property onProgress Optional awaited checkpoint callback; defaults to no reporting.
 */
export type SplitRecordParameters = { asset: RecordAsset; record: InventoryRecord; amount: bigint; onProgress?: ProvingProgressHandler }

/**
 * Splits a token record into two positive records through its native transition.
 * Credits subtract 10,000 microcredits from the second output; signs and broadcasts.
 * @param client Wallet client; recordActions enables shared reservations.
 * @param params Source record and positive first output amount (u64 credits, u128 tokens).
 * @returns Submitted transaction id, before confirmation.
 * @throws When either output would be empty or inputs are incompatible.
 * @example
 * const transactionId = await splitRecord(client, { asset, record, amount: 500_000n })
 */
export async function splitRecord(client: Client, params: SplitRecordParameters): Promise<string> {
  const capabilities = await validateAsset(client, params.asset)
  const record = decodeRecord(client, params.asset, params.record.record, capabilities)
  if (!record || typeof params.amount !== 'bigint' || params.amount <= 0n ||
    params.amount + splitDeduction(params.asset) >= record.amount) throw new Error('Split must produce two positive eligible records')
  return writeContract(client, { program: params.asset.program, function: 'split',
    inputs: [recordInput(client, params.asset, record), `${params.amount}${amountWidth(params.asset)}`], onProgress: params.onProgress })
}
