import { classifyBroadcastError, DuplicateTransactionError } from '@provablehq/veil-core'
import { isHash, isHex } from 'viem'
import { requireAleoClient, requireAleoClientWithWallet, type BridgeChainClients } from '../connections/resolve.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeExecution, CompleteParameters } from '../types/actions.js'
import type { BridgeReceipt, BridgeRegistry } from '../types/protocol.js'
import { complete as completePrivateMint } from '../protocols/xreserve/evmToAleo.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'
import { createBridgeCheckpoint } from './createBridgeCheckpoint.js'

/**
 * Submits the destination-chain transaction required to receive bridged funds.
 *
 * This currently applies to a private USDC-to-USDCx xReserve transfer after
 * Circle has attested the source deposit. The Aleo wallet proves, signs, and
 * submits the private mint that delivers a private record to the recipient.
 *
 * The source transaction is never repeated. The destination transaction incurs
 * an Aleo network fee even if it fails.
 *
 * @param registry Supported chains, assets, and bridge provider deployments.
 * @param clients Network and wallet access for the Aleo destination chain.
 * @param params Transfer state ready for private delivery, fee preference, secret nonce, and optional callback for saving recovery information.
 * @returns The Aleo transaction identifier and the destination confirmation state.
 * @throws BridgeError When no destination transaction is required, the Circle attestation is invalid, required wallet access is unavailable, or submission fails.
 * @example const execution = await complete(registry, clients, { plan, receipt: ready, onCheckpoint: save })
 */
export async function complete(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  params: CompleteParameters,
): Promise<BridgeExecution> {
  let plan: import('../types/protocol.js').BridgePlan
  let receipt: BridgeReceipt
  // Accept either recovered progress or the equivalent in-memory pair. Both
  // paths must reach the same explicit destination-authorization boundary.
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
  // These values came from Circle but are untrusted persisted input on a later
  // process. Validate their wire encodings again before involving the wallet.
  if (typeof payload !== 'string' || !isHex(payload, { strict: true })
    || typeof messageHash !== 'string' || !isHash(messageHash)
    || typeof attestation !== 'string' || !isHex(attestation, { strict: true })) {
    throw new BridgeError('Ready xReserve receipt is missing its validated Circle attestation')
  }
  const preparedTransaction = receipt.protocolState.preparedDestinationTransaction
  if (preparedTransaction !== undefined) {
    // A previous process finished proving the private mint but stopped before
    // broadcast. Submit those exact bytes so the transaction id and proof remain stable.
    if (typeof preparedTransaction !== 'string' || !preparedTransaction) {
      throw new BridgeError('Prepared Aleo destination recovery is missing its serialized transaction')
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(preparedTransaction)
    } catch (error) {
      throw new BridgeError('Prepared Aleo destination recovery contains an invalid serialized transaction', { cause: error })
    }
    // Duplicate means the prior broadcast won the crash race. Treat it as the
    // same transfer and continue confirmation rather than creating a new mint.
    const transactionId = decoded && typeof decoded === 'object'
      ? (decoded as { id?: unknown }).id
      : undefined
    if (typeof transactionId !== 'string' || transactionId !== receipt.id) {
      throw new BridgeError('Prepared Aleo destination recovery transaction id does not match its payload')
    }
    try {
      const submittedId = await requireAleoClient(
        registry,
        clients,
        route.destinationChain.id,
      ).publicClient.request({
        method: 'sendTransaction',
        params: { transaction: preparedTransaction },
      }) as string
      if (submittedId !== transactionId) {
        throw new BridgeError(`Aleo node returned transaction id ${submittedId}; expected ${transactionId}`)
      }
    } catch (error) {
      if (error instanceof BridgeError) throw error
      const classified = classifyBroadcastError(error, transactionId)
      if (!(classified instanceof DuplicateTransactionError)) throw classified
    }
    const { nextAction: _nextAction, ...ready } = receipt
    const submitted: BridgeReceipt = {
      ...ready,
      status: 'DESTINATION_CONFIRMING',
      destinationTxId: transactionId,
      protocolState: {
        ...ready.protocolState,
        preparedDestinationTransaction: undefined,
      },
    }
    await params.onCheckpoint?.(createBridgeCheckpoint(plan, submitted))
    return { kind: 'aleo-xreserve', transactionId, receipt: submitted }
  }
  const { nextAction: _nextAction, ...deposit } = receipt
  // No proved transaction was recovered, so this is the only point where the
  // destination wallet may be asked to prove and authorize the private mint.
  const result = await completePrivateMint(
    registry,
    requireAleoClientWithWallet(registry, clients, route.destinationChain.id, 'complete xReserve private mint').walletClient,
    {
      plan,
      deposit: { ...deposit, status: 'ATTESTATION_PENDING' },
      attestation: { status: 'complete', payload, messageHash, attestation },
      privateFee: params.privateFee,
      onProgress: params.onProgress,
      onPrepared: params.onCheckpoint
        ? async (transaction) => params.onCheckpoint?.(createBridgeCheckpoint(plan, {
            ...receipt,
            id: transaction.id,
            protocolState: {
              ...receipt.protocolState,
              preparedDestinationTransaction: JSON.stringify(transaction),
            },
          }))
        : undefined,
      privateMintSecretNonce: params.privateMintSecretNonce,
      onSubmitted: params.onCheckpoint
        ? async (submitted) => params.onCheckpoint?.(createBridgeCheckpoint(plan, submitted))
        : undefined,
    },
  )
  return { kind: 'aleo-xreserve', ...result }
}
