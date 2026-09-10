import { transactionStatus } from '@provablehq/veil-core'
import { isHash } from 'viem'
import { requireAleoClient, requireEvmClient, requireSolanaClient, type BridgeChainClients } from '../connections/resolve.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { GetStatusParameters } from '../types/actions.js'
import type { BridgeReceipt, BridgeRegistry } from '../types/protocol.js'
import type { XReserveHttpTransport } from '../types/xreserve.js'
import { getAttestation, getSourceStatus } from '../protocols/xreserve/evmToAleo.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'
import { aleoAddressToBytes32 } from '../utils/xreserve.js'
import { getSourceStatus as getEvmHyperlaneSourceStatus } from '../protocols/hyperlane/evm.js'
import { getSourceStatus as getSolanaHyperlaneSourceStatus } from '../protocols/hyperlane/solana.js'

function withoutNextAction(receipt: BridgeReceipt): Omit<BridgeReceipt, 'nextAction'> {
  const { nextAction: _nextAction, ...rest } = receipt
  return rest
}

/**
 * Refreshes one bridge receipt without signing or submitting transactions.
 *
 * Currently supports the Circle attestation and Aleo confirmation phases of
 * private EVM-to-Aleo xReserve transfers. Performs at most one protocol or
 * chain read.
 *
 * @param registry Reviewed deployment snapshot.
 * @param clients Materialized chain clients keyed by registry chain id.
 * @param client Fetch-compatible transport used for Circle attestation reads.
 * @param params Original plan, persisted receipt, and optional cancellation signal.
 * @returns The unchanged receipt or its next validated lifecycle state.
 * @throws BridgeError When the plan, receipt, protocol response, or required client is invalid.
 * @example const receipt = await getStatus(registry, clients, fetch, { plan, receipt: checkpoint })
 */
export async function getStatus(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  client: XReserveHttpTransport,
  params: GetStatusParameters,
): Promise<BridgeReceipt> {
  const route = resolveTransferRoute(registry, params.plan)
  const receipt = params.receipt
  if (receipt.protocol !== params.plan.protocol || receipt.protocolState.routeId !== params.plan.route.id) {
    throw new BridgeError('Bridge receipt does not match the prepared route')
  }

  if (receipt.status === 'SOURCE_APPROVAL_PENDING' && route.sourceChain.family === 'evm') {
    if (!isHash(receipt.id)) throw new BridgeError('Bridge receipt is missing its EVM approval transaction id')
    const evm = requireEvmClient(registry, clients, route.sourceChain.id)
    const result = await evm.publicClient.getTransactionReceipt(receipt.id)
    if (!result) return receipt
    if (result.status === 'reverted') {
      return {
        ...withoutNextAction(receipt),
        status: 'FAILED',
        protocolState: { ...receipt.protocolState, sourceError: `EVM approval transaction reverted: ${receipt.id}` },
      }
    }
    return { ...receipt, status: 'SOURCE_SUBMISSION_PENDING' }
  }

  if (receipt.status === 'SOURCE_CONFIRMING' && route.sourceChain.family === 'aleo') {
    const transactionId = receipt.sourceTxId
    if (!transactionId) throw new BridgeError('Bridge receipt is missing its Aleo source transaction id')
    const aleo = requireAleoClient(registry, clients, route.sourceChain.id)
    const result = await transactionStatus(aleo.publicClient, { transactionId })
    if (result.status === 'accepted') {
      return { ...withoutNextAction(receipt), status: 'DELIVERY_PENDING' }
    }
    if (result.status === 'rejected') {
      return {
        ...withoutNextAction(receipt),
        status: 'FAILED',
        protocolState: { ...receipt.protocolState, sourceError: result.error ?? 'Aleo transaction was rejected' },
      }
    }
    return receipt
  }

  if (receipt.status === 'SOURCE_CONFIRMING'
    && route.route.protocol === 'hyperlane'
    && route.sourceChain.family === 'evm') {
    return getEvmHyperlaneSourceStatus(
      registry,
      requireEvmClient(registry, clients, route.sourceChain.id),
      params.plan,
      aleoAddressToBytes32(params.plan.recipient),
      receipt,
    )
  }

  if (receipt.status === 'SOURCE_CONFIRMING'
    && route.route.protocol === 'hyperlane'
    && route.sourceChain.family === 'solana') {
    return getSolanaHyperlaneSourceStatus(
      requireSolanaClient(registry, clients, route.sourceChain.id),
      receipt,
    )
  }

  if (route.route.protocol !== 'xreserve' || route.sourceChain.family !== 'evm' || route.destinationChain.family !== 'aleo') {
    throw new BridgeError('Status refresh is not implemented for this bridge route')
  }

  if (receipt.status === 'SOURCE_CONFIRMING') {
    return getSourceStatus(
      registry,
      requireEvmClient(registry, clients, route.sourceChain.id),
      params.plan,
      receipt,
    )
  }

  if (receipt.status === 'ATTESTATION_PENDING') {
    const messageHash = receipt.protocolState.messageHash
    if (typeof messageHash !== 'string' || !isHash(messageHash)) {
      throw new BridgeError('xReserve receipt is missing its Circle message hash')
    }
    const attestation = await getAttestation(registry, client, {
      routeId: params.plan.route.id,
      messageHash,
      signal: params.signal,
    })
    if (attestation.status === 'pending') return receipt
    if (params.plan.mintMode !== 'private') {
      return { ...receipt, status: 'DELIVERY_PENDING', protocolState: { ...receipt.protocolState, attestation: attestation.attestation } }
    }
    return {
      ...receipt,
      status: 'DESTINATION_ACTION_REQUIRED',
      nextAction: { kind: 'xreserve-private-mint', chainId: route.destinationChain.id },
      protocolState: { ...receipt.protocolState, attestation: attestation.attestation },
    }
  }

  if (receipt.status === 'DESTINATION_ACTION_REQUIRED') return receipt

  if (receipt.status === 'DESTINATION_CONFIRMING') {
    const transactionId = receipt.destinationTxId
    if (!transactionId) throw new BridgeError('xReserve receipt is missing its Aleo destination transaction id')
    const aleo = requireAleoClient(registry, clients, route.destinationChain.id)
    const result = await transactionStatus(aleo.publicClient, { transactionId })
    if (result.status === 'accepted') {
      return { ...withoutNextAction(receipt), status: 'COMPLETED' }
    }
    if (result.status === 'rejected') {
      return {
        ...withoutNextAction(receipt),
        status: 'FAILED',
        protocolState: { ...receipt.protocolState, destinationError: result.error ?? 'Aleo transaction was rejected' },
      }
    }
    return receipt
  }

  return receipt
}
