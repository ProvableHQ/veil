import type { TransactionInput } from '@provablehq/veil-core'
import { requireAleoClientWithWallet, type BridgeChainClients } from '../connections/resolve.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { AleoPrivacyExecution, ShieldParameters } from '../types/aleo.js'
import type { BridgeRegistry } from '../types/protocol.js'
import { privacyAmount, resolvePrivacyAsset } from './internal/aleoPrivacy.js'

/**
 * Converts an Aleo token balance visible on the public ledger into a private record owned by the recipient.
 *
 * A private record stores spendable value without exposing the owner or amount
 * in a public account balance. The Aleo wallet proves and submits the
 * conversion, which spends the public balance and incurs an Aleo transaction
 * fee.
 *
 * @param registry Supported Aleo assets and their public-to-private conversion programs.
 * @param clients Network and wallet access for Aleo.
 * @param params Asset, amount, optional private recipient, fee preference, and proving progress callbacks.
 * @returns The submitted Aleo transaction identifier and exact converted amount.
 * @throws BridgeError When the asset cannot be converted privately, the amount is invalid, required wallet access is unavailable, or submission fails.
 * @example
 * await shield(registry, clients, { asset: { chain: 'aleo', asset: 'sol' }, amount: '0.1' })
 */
export async function shield(registry: BridgeRegistry, clients: BridgeChainClients, params: ShieldParameters): Promise<AleoPrivacyExecution> {
  const asset = resolvePrivacyAsset(registry, params.asset, 'shielding')
  const { amountAtomic, literal } = privacyAmount(asset, params.amount, 'Shielding')
  const { walletClient } = requireAleoClientWithWallet(registry, clients, asset.chainId, `shield ${asset.symbol}`)
  // ARC-22 names the private recipient explicitly. ARC-20's shield transition
  // always creates the record for its caller and accepts only the amount.
  const inputs: TransactionInput[] = asset.privacy.kind === 'arc22'
    ? [params.recipient ?? { type: 'address', label: `${asset.symbol} private recipient` }, literal]
    : [literal]
  // The wallet performs proving, signing, and broadcast. A prepared-transaction
  // callback lets applications cover the pre-broadcast crash window without
  // giving this action control of storage.
  const transactionId = await walletClient.executeTransaction({
    program: asset.privacy.program,
    function: asset.privacy.kind === 'arc22' ? 'transfer_public_to_private' : 'shield',
    inputs,
    privateFee: params.privateFee ?? false,
    onProgress: async (event) => {
      await params.onProgress?.(event)
      if (event.type === 'transaction-prepared') await params.onPrepared?.(event.transaction)
    },
  })
  if (!transactionId) throw new BridgeError(`Aleo wallet returned an empty ${asset.symbol} shield transaction id`)
  return { transactionId, assetId: asset.id, amount: params.amount, amountAtomic }
}
