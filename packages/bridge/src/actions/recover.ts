import { BridgeError } from '../errors/bridgeErrors.js'
import { requireEvmClient, type BridgeChainClients } from '../connections/resolve.js'
import type { RecoverParameters } from '../types/actions.js'
import type { BridgeProgress, BridgeReceipt, BridgeRegistry } from '../types/protocol.js'
import type { XReserveHttpTransport } from '../types/xreserve.js'
import { recoverSourceCheckpoint } from '../protocols/xreserve/evmToAleo.js'
import { recoverSourceCheckpoint as recoverEvmHyperlaneSource } from '../protocols/hyperlane/evm.js'
import { aleoAddressToBytes32 } from '../utils/xreserve.js'
import { getStatus } from './getStatus.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'
import { prepare } from './prepare.js'
import { toBridgeProgress } from './internal/toBridgeProgress.js'

/**
 * Reconstructs bridge progress from a versioned submission checkpoint.
 *
 * Performs read-only chain and protocol operations and never signs or submits
 * a transaction.
 *
 * @param registry Reviewed deployment snapshot.
 * @param clients Materialized chain clients used only for status reads.
 * @param client Fetch-compatible protocol transport used for attestation reads.
 * @param params Self-contained public recovery checkpoint.
 * @returns Reconstructed runtime state and the caller's next operation.
 * @throws BridgeError When the checkpoint is invalid, stale, or unsupported by the selected route.
 * @example const progress = await recover(registry, clients, fetch, { checkpoint })
 */
export async function recover(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  client: XReserveHttpTransport,
  params: RecoverParameters,
): Promise<BridgeProgress> {
  const checkpoint = params.checkpoint
  if (checkpoint.version !== 1 || !checkpoint.intent || !checkpoint.route) {
    throw new BridgeError('Bridge checkpoint format is invalid or unsupported')
  }
  const plan = prepare(registry, checkpoint.intent)
  const route = resolveTransferRoute(registry, plan)
  if (checkpoint.version !== 1
    || checkpoint.route.id !== plan.route.id
    || checkpoint.route.registryVersion !== plan.registryVersion) {
    throw new BridgeError('Bridge checkpoint does not match the prepared route')
  }
  let receipt: BridgeReceipt
  if (route.sourceChain.family === 'aleo') {
    if (!checkpoint.source?.transactionId) {
      throw new BridgeError('Bridge checkpoint contains no submitted source transaction')
    }
    if (checkpoint.destination || (checkpoint.source.approvalTransactionIds?.length ?? 0) > 0) {
      throw new BridgeError('Bridge checkpoint contains transactions that are invalid for an Aleo source route')
    }
    receipt = await getStatus(registry, clients, client, {
      plan,
      receipt: {
        id: checkpoint.source.transactionId,
        protocol: plan.protocol,
        status: 'SOURCE_CONFIRMING',
        sourceTxId: checkpoint.source.transactionId,
        protocolState: { routeId: checkpoint.route.id },
      },
      signal: params.signal,
    })
    return toBridgeProgress(plan, receipt)
  }
  if (route.sourceChain.family === 'solana') {
    if (!checkpoint.source?.transactionId) {
      throw new BridgeError('Bridge checkpoint contains no submitted source transaction')
    }
    if (checkpoint.destination || (checkpoint.source.approvalTransactionIds?.length ?? 0) > 0) {
      throw new BridgeError('Bridge checkpoint contains transactions that are invalid for a Solana source route')
    }
    receipt = await getStatus(registry, clients, client, {
      plan,
      receipt: {
        id: checkpoint.source.transactionId,
        protocol: plan.protocol,
        status: 'SOURCE_CONFIRMING',
        sourceTxId: checkpoint.source.transactionId,
        protocolState: { routeId: checkpoint.route.id },
      },
      signal: params.signal,
    })
    return toBridgeProgress(plan, receipt)
  }
  if (route.route.protocol === 'hyperlane' && route.sourceChain.family === 'evm') {
    if (checkpoint.destination) {
      throw new BridgeError('Bridge checkpoint contains a destination transaction that is invalid for this Hyperlane route')
    }
    receipt = await recoverEvmHyperlaneSource(
      registry,
      requireEvmClient(registry, clients, route.sourceChain.id),
      plan,
      aleoAddressToBytes32(plan.recipient),
      checkpoint,
    )
    return toBridgeProgress(plan, receipt)
  }
  if (route.route.protocol !== 'xreserve'
    || route.sourceChain.family !== 'evm'
    || route.destinationChain.family !== 'aleo') {
    throw new BridgeError('Bridge checkpoint recovery is not implemented for this route')
  }
  receipt = await recoverSourceCheckpoint(
    registry,
    requireEvmClient(registry, clients, route.sourceChain.id),
    plan,
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
    receipt = await getStatus(registry, clients, client, {
      plan,
      receipt,
      signal: params.signal,
    })
  }
  return toBridgeProgress(plan, receipt)
}
