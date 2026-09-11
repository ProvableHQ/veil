import type { TransactionInput } from '@provablehq/veil-core'
import { requireAleoClientWithWallet, type BridgeChainClients } from '../connections/resolve.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { AleoPrivacyExecution, UnshieldParameters } from '../types/aleo.js'
import type { BridgeRegistry } from '../types/protocol.js'
import { EMPTY_MERKLE_PROOF_PAIR, privacyAmount, privacyRecord, resolvePrivacyAsset } from './internal/aleoPrivacy.js'

/**
 * Unshields an Aleo asset's private record into a public balance.
 *
 * Defaults to wallet-side record selection, keeping record plaintext out of
 * applications that use compatible wallets. ARC-22 assets use the canonical
 * empty-tree freeze-list proof unless the caller supplies a current witness.
 *
 * @param registry Reviewed asset registry containing the privacy capability.
 * @param clients Registry-keyed clients containing an Aleo wallet client.
 * @param params Asset, decimal amount, and optional record, recipient, proof, and execution controls.
 * @returns Submitted transaction id and exact converted amount.
 * @throws BridgeError When the asset is unknown, lacks unshielding support, the amount is invalid, no wallet is configured, or the wallet returns no transaction id.
 * @example
 * await unshield(registry, clients, { asset: { chain: 'aleo', asset: 'sol' }, amount: '0.1' })
 */
export async function unshield(registry: BridgeRegistry, clients: BridgeChainClients, params: UnshieldParameters): Promise<AleoPrivacyExecution> {
  const asset = resolvePrivacyAsset(registry, params.asset, 'unshielding')
  const { amountAtomic, literal } = privacyAmount(asset, params.amount, 'Unshielding')
  const { walletClient } = requireAleoClientWithWallet(registry, clients, asset.chainId, `unshield ${asset.symbol}`)
  const record: TransactionInput = params.record ?? privacyRecord(asset.privacy.program, literal)
  const inputs: TransactionInput[] = asset.privacy.kind === 'arc22'
    ? [
        params.recipient ?? { type: 'address', label: `${asset.symbol} public recipient` },
        literal,
        record,
        params.merkleProof ?? EMPTY_MERKLE_PROOF_PAIR,
      ]
    : [record, literal]
  const transactionId = await walletClient.executeTransaction({
    program: asset.privacy.program,
    function: asset.privacy.kind === 'arc22' ? 'transfer_private_to_public' : 'unshield',
    inputs,
    privateFee: params.privateFee ?? false,
    onProgress: async (event) => {
      await params.onProgress?.(event)
      if (event.type === 'transaction-prepared') await params.onPrepared?.(event.transaction)
    },
  })
  if (!transactionId) throw new BridgeError(`Aleo wallet returned an empty ${asset.symbol} unshield transaction id`)
  return { transactionId, assetId: asset.id, amount: params.amount, amountAtomic }
}
