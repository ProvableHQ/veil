import type { Client } from '../../clients/createClient.js'
import type { InventoryRecord, RecordAsset } from '../../inventory/types.js'
import type { ProvingProgressHandler } from '../../types/proving.js'
import { writeContract } from '../wallet/writeContract.js'
import { amountWidth, decodeRecord, recordInput, splitDeduction, validateAsset } from './internal.js'

/**
 * Supplies an owned record for a native split.
 * @property asset Program with optional record-name and amount-field overrides.
 * @property record Source record from getRecordInventory.
 * @property amount Positive first output in integer base units (bounded by the declared field width).
 * @property onProgress Optional awaited checkpoint callback; defaults to no reporting.
 */
export type SplitRecordParameters = { asset: RecordAsset; record: InventoryRecord; amount: bigint; onProgress?: ProvingProgressHandler }

/**
 * Splits a token record into two positive records through its native transition.
 * Credits subtract 10,000 microcredits from the second output; signs and broadcasts.
 * @param client Wallet client; recordManagement.enabled opts into shared reservations.
 * @param params Source record and positive first output amount (bounded by the declared field width).
 * @returns Submitted transaction id, before confirmation.
 * @throws When either output would be empty or inputs are incompatible.
 * @example
 * import { waitForConfirmation, type WalletClient } from '@provablehq/veil-core'
 *
 * async function splitOneCredit(client: WalletClient) {
 *   const asset = { program: 'credits.aleo' }
 *   const amount = 1_000_000n // One credit, expressed in microcredits.
 *   const deduction = 10_000n // Native credits split deduction, separate from fees.
 *   const inventory = await client.getRecordInventory({ asset })
 *   const record = inventory.available.find((item) => item.amount > amount + deduction)
 *   if (!record) throw new Error('No record can produce two positive outputs')
 *
 *   // The first output holds amount; the second holds this remainder.
 *   console.log('Second output in microcredits:', (record.amount - amount - deduction).toString())
 *   const transactionId = await client.splitRecord({ asset, record, amount })
 *   await waitForConfirmation(client, transactionId, 120_000)
 *   // Rescan after the scanner indexes the outputs before selecting either.
 *   return transactionId
 * }
 */
export async function splitRecord(client: Client, params: SplitRecordParameters): Promise<string> {
  const capabilities = await validateAsset(client, params.asset)
  const asset = capabilities.asset
  const record = decodeRecord(client, params.asset, params.record.record, capabilities)
  // Account for the intrinsic credits deduction when checking the second output;
  // both outputs must remain positive after the native split executes.
  if (!record || typeof params.amount !== 'bigint' || params.amount <= 0n ||
    params.amount + splitDeduction(asset) >= record.amount) throw new Error('Split must produce two positive eligible records')
  return writeContract(client, { program: params.asset.program, function: 'split',
    inputs: [recordInput(client, asset, record), `${params.amount}${amountWidth(asset)}`], onProgress: params.onProgress })
}
