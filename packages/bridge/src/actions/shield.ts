import type { TransactionInput } from '@provablehq/veil-core'
import { requireAleoClientWithWallet, type BridgeChainClients } from '../connections/resolve.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { AleoPrivacyExecution, ShieldParameters } from '../types/aleo.js'
import type { BridgeRegistry } from '../types/protocol.js'
import { privacyAmount, resolvePrivacyAsset } from './internal/aleoPrivacy.js'

/**
 * Shields an Aleo asset's public balance into a private record.
 *
 * Resolves the asset's declared ARC-20 or ARC-22 ABI, proves through the
 * configured Aleo wallet, and broadcasts the transaction.
 *
 * @param registry Reviewed asset registry containing the privacy capability.
 * @param clients Registry-keyed clients containing an Aleo wallet client.
 * @param params Asset, decimal amount, and optional execution controls.
 * @returns Submitted transaction id and exact converted amount.
 * @throws BridgeError When the asset is unknown, lacks shielding support, the amount is invalid, no wallet is configured, or the wallet returns no transaction id.
 * @example
 * await shield(registry, clients, { asset: { chain: 'aleo', asset: 'sol' }, amount: '0.1' })
 */
export async function shield(registry: BridgeRegistry, clients: BridgeChainClients, params: ShieldParameters): Promise<AleoPrivacyExecution> {
  const asset = resolvePrivacyAsset(registry, params.asset, 'shielding')
  const { amountAtomic, literal } = privacyAmount(asset, params.amount, 'Shielding')
  const { walletClient } = requireAleoClientWithWallet(registry, clients, asset.chainId, `shield ${asset.symbol}`)
  const inputs: TransactionInput[] = asset.privacy.kind === 'arc22'
    ? [params.recipient ?? { type: 'address', label: `${asset.symbol} private recipient` }, literal]
    : [literal]
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
