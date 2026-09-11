import type { TransactionInput } from '@provablehq/veil-core'
import { requireAleoClientWithWallet, type BridgeChainClients } from '../connections/resolve.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { AleoPrivacyExecution, UnshieldParameters } from '../types/aleo.js'
import type { BridgeRegistry } from '../types/protocol.js'
import { EMPTY_MERKLE_PROOF_PAIR, privacyAmount, privacyRecord, resolvePrivacyAsset } from './internal/aleoPrivacy.js'

/**
 * Converts an Aleo private record into a token balance visible on the public ledger.
 *
 * A private record stores spendable value without exposing the owner or amount
 * in a public account balance. The wallet selects a sufficient record unless
 * the caller supplies one, then proves and submits the conversion. The public
 * recipient and amount become visible, and the transaction incurs an Aleo fee.
 *
 * @param registry Supported Aleo assets and their private-to-public conversion programs.
 * @param clients Network and wallet access for Aleo.
 * @param params Asset, amount, optional private record and public recipient, fee preference, freeze-list proof, and proving progress callbacks.
 * @returns The submitted Aleo transaction identifier and exact converted amount.
 * @throws BridgeError When the asset cannot be converted publicly, the amount or private record is invalid, required wallet access is unavailable, or submission fails.
 * @example
 * await unshield(registry, clients, { asset: { chain: 'aleo', asset: 'sol' }, amount: '0.1' })
 */
export async function unshield(registry: BridgeRegistry, clients: BridgeChainClients, params: UnshieldParameters): Promise<AleoPrivacyExecution> {
  const asset = resolvePrivacyAsset(registry, params.asset, 'unshielding')
  const { amountAtomic, literal } = privacyAmount(asset, params.amount, 'Unshielding')
  const { walletClient } = requireAleoClientWithWallet(registry, clients, asset.chainId, `unshield ${asset.symbol}`)
  // Leave record selection inside the wallet unless the caller supplies a
  // plaintext record. This keeps private ownership data out of browser and bot
  // application state when the wallet supports structured record requests.
  const record: TransactionInput = params.record ?? privacyRecord(asset.privacy.program, literal)
  // ARC-22 additionally names the public recipient and proves the token is not
  // frozen. The empty-tree proof is the currently supported default; callers
  // can replace it when a token publishes a populated freeze list.
  const inputs: TransactionInput[] = asset.privacy.kind === 'arc22'
    ? [
        params.recipient ?? { type: 'address', label: `${asset.symbol} public recipient` },
        literal,
        record,
        params.merkleProof ?? EMPTY_MERKLE_PROOF_PAIR,
      ]
    : [record, literal]
  // The wallet performs proving, signing, and broadcast. A prepared-transaction
  // callback lets applications cover the pre-broadcast crash window without
  // giving this action control of storage.
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
