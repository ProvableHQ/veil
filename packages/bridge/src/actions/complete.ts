import { isHash, isHex } from 'viem'
import { requireAleoClientWithWallet, type BridgeChainClients } from '../connections/resolve.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeExecution, CompleteParameters } from '../types/actions.js'
import type { BridgeReceipt, BridgeRegistry } from '../types/protocol.js'
import { complete as completePrivateMint } from '../protocols/xreserve/evmToAleo.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'
import { createBridgeCheckpoint } from './createBridgeCheckpoint.js'

/**
 * Submits one caller-authorized destination operation from a ready receipt.
 *
 * Never polls or repeats a source transaction. Currently completes private
 * EVM-to-Aleo xReserve transfers by submitting one Aleo `private_mint` call.
 *
 * @param registry Reviewed deployment snapshot.
 * @param clients Materialized chain clients keyed by registry chain id.
 * @param params Ready receipt, original plan, fee preference, and durable submission hook.
 * @returns The destination-confirming execution state.
 * @throws BridgeError When no supported destination action is ready or its persisted attestation is invalid.
 * @example const execution = await complete(registry, clients, { plan, receipt: ready, onCheckpoint: save })
 */
export async function complete(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  params: CompleteParameters,
): Promise<BridgeExecution> {
  let plan: import('../types/protocol.js').BridgePlan
  let receipt: BridgeReceipt
  if (params.progress) {
    if (params.progress.next !== 'complete') {
      throw new BridgeError('Bridge progress has no destination action to complete')
    }
    plan = params.progress.plan
    receipt = params.progress.receipt
  } else if (params.plan && params.receipt) {
    plan = params.plan
    receipt = params.receipt
  } else {
    throw new BridgeError('Bridge completion requires recovered progress')
  }
  const route = resolveTransferRoute(registry, plan)
  if (receipt.status !== 'DESTINATION_ACTION_REQUIRED'
    || receipt.nextAction?.kind !== 'xreserve-private-mint'
    || receipt.nextAction.chainId !== route.destinationChain.id) {
    throw new BridgeError('Bridge receipt has no supported destination action ready')
  }
  if (route.route.protocol !== 'xreserve' || route.sourceChain.family !== 'evm' || route.destinationChain.family !== 'aleo') {
    throw new BridgeError('Destination completion is not implemented for this bridge route')
  }
  const payload = receipt.protocolState.payload
  const messageHash = receipt.protocolState.messageHash
  const attestation = receipt.protocolState.attestation
  if (typeof payload !== 'string' || !isHex(payload, { strict: true })
    || typeof messageHash !== 'string' || !isHash(messageHash)
    || typeof attestation !== 'string' || !isHex(attestation, { strict: true })) {
    throw new BridgeError('Ready xReserve receipt is missing its validated Circle attestation')
  }
  const { nextAction: _nextAction, ...deposit } = receipt
  const result = await completePrivateMint(
    registry,
    requireAleoClientWithWallet(registry, clients, route.destinationChain.id, 'complete xReserve private mint').walletClient,
    {
      plan,
      deposit: { ...deposit, status: 'ATTESTATION_PENDING' },
      attestation: { status: 'complete', payload, messageHash, attestation },
      privateFee: params.privateFee,
      privateMintSecretNonce: params.privateMintSecretNonce,
      onSubmitted: params.onCheckpoint
        ? async (submitted) => params.onCheckpoint?.(createBridgeCheckpoint(plan, submitted))
        : undefined,
    },
  )
  return { kind: 'aleo-xreserve', ...result }
}
