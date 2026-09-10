import { BridgeError } from '../errors/bridgeErrors.js'
import { requireEvmClient, type BridgeChainClients } from '../connections/resolve.js'
import type { RecoverParameters } from '../types/actions.js'
import type { BridgeReceipt, BridgeRegistry } from '../types/protocol.js'
import type { XReserveHttpTransport } from '../types/xreserve.js'
import { recoverSourceCheckpoint } from '../protocols/xreserve/evmToAleo.js'
import { recoverSourceCheckpoint as recoverEvmHyperlaneSource } from '../protocols/hyperlane/evm.js'
import { aleoAddressToBytes32 } from '../utils/xreserve.js'
import { getStatus } from './getStatus.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'

/**
 * Reconstructs bridge progress from a versioned submission checkpoint.
 *
 * Performs read-only chain and protocol operations and never signs or submits
 * a transaction.
 *
 * @param registry Reviewed deployment snapshot.
 * @param clients Materialized chain clients used only for status reads.
 * @param client Fetch-compatible protocol transport used for attestation reads.
 * @param params Prepared transfer and compact recovery checkpoint.
 * @returns Reconstructed transfer receipt.
 * @throws BridgeError Until the selected route implements checkpoint recovery.
 * @example const receipt = await recover(registry, clients, fetch, { plan, checkpoint })
 */
export async function recover(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  client: XReserveHttpTransport,
  params: RecoverParameters,
): Promise<BridgeReceipt> {
  const route = resolveTransferRoute(registry, params.plan)
  const checkpoint = params.checkpoint
  if (checkpoint.version !== 1
    || checkpoint.routeId !== params.plan.route.id
    || checkpoint.protocol !== params.plan.protocol) {
    throw new BridgeError('Bridge checkpoint does not match the prepared route')
  }
  if (route.sourceChain.family === 'aleo') {
    if (!checkpoint.source?.transactionId) {
      throw new BridgeError('Bridge checkpoint contains no submitted source transaction')
    }
    if (checkpoint.destination || (checkpoint.source.approvalTransactionIds?.length ?? 0) > 0) {
      throw new BridgeError('Bridge checkpoint contains transactions that are invalid for an Aleo source route')
    }
    return getStatus(registry, clients, client, {
      plan: params.plan,
      receipt: {
        id: checkpoint.source.transactionId,
        protocol: checkpoint.protocol,
        status: 'SOURCE_CONFIRMING',
        sourceTxId: checkpoint.source.transactionId,
        protocolState: { routeId: checkpoint.routeId },
      },
      signal: params.signal,
    })
  }
  if (route.sourceChain.family === 'solana') {
    if (!checkpoint.source?.transactionId) {
      throw new BridgeError('Bridge checkpoint contains no submitted source transaction')
    }
    if (checkpoint.destination || (checkpoint.source.approvalTransactionIds?.length ?? 0) > 0) {
      throw new BridgeError('Bridge checkpoint contains transactions that are invalid for a Solana source route')
    }
    return getStatus(registry, clients, client, {
      plan: params.plan,
      receipt: {
        id: checkpoint.source.transactionId,
        protocol: checkpoint.protocol,
        status: 'SOURCE_CONFIRMING',
        sourceTxId: checkpoint.source.transactionId,
        protocolState: { routeId: checkpoint.routeId },
      },
      signal: params.signal,
    })
  }
  if (route.route.protocol === 'hyperlane' && route.sourceChain.family === 'evm') {
    if (checkpoint.destination) {
      throw new BridgeError('Bridge checkpoint contains a destination transaction that is invalid for this Hyperlane route')
    }
    return recoverEvmHyperlaneSource(
      registry,
      requireEvmClient(registry, clients, route.sourceChain.id),
      params.plan,
      aleoAddressToBytes32(params.plan.recipient),
      checkpoint,
    )
  }
  if (route.route.protocol !== 'xreserve'
    || route.sourceChain.family !== 'evm'
    || route.destinationChain.family !== 'aleo') {
    throw new BridgeError('Bridge checkpoint recovery is not implemented for this route')
  }
  let receipt = await recoverSourceCheckpoint(
    registry,
    requireEvmClient(registry, clients, route.sourceChain.id),
    params.plan,
    checkpoint,
  )
  if (checkpoint.destination) {
    receipt = {
      ...receipt,
      status: 'DESTINATION_CONFIRMING',
      destinationTxId: checkpoint.destination.transactionId,
    }
  }
  if (receipt.status === 'ATTESTATION_PENDING' || receipt.status === 'DESTINATION_CONFIRMING') {
    return getStatus(registry, clients, client, {
      plan: params.plan,
      receipt,
      signal: params.signal,
    })
  }
  return receipt
}
