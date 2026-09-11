import { classifyBroadcastError, DuplicateTransactionError } from '@provablehq/veil-core'
import { requireAleoClient, requireEvmClientWithWallet, type BridgeChainClients } from '../connections/resolve.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import * as evmHyperlane from '../protocols/hyperlane/evm.js'
import * as evmToAleoXReserve from '../protocols/xreserve/evmToAleo.js'
import type { ResumeParameters, BridgeExecution } from '../types/actions.js'
import type { BridgeRegistry, BridgeReceipt } from '../types/protocol.js'
import { aleoAddressToBytes32 } from '../utils/xreserve.js'
import { createBridgeCheckpoint } from './createBridgeCheckpoint.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'

/**
 * Continues the remaining source submission from recovered progress.
 *
 * Calls a wallet only when recovery identified a confirmed approval with no
 * irreversible source transfer. It never repeats a checkpointed transaction.
 *
 * @param registry Reviewed deployment snapshot.
 * @param clients Materialized chain clients used for the remaining submission.
 * @param params Recovered resumable progress and optional confirmation controls.
 * @returns Protocol-discriminated execution state after source continuation.
 * @throws BridgeError When progress is not resumable or the route lacks source resumption.
 * @example const execution = await resume(registry, clients, { progress })
 */
export async function resume(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  params: ResumeParameters,
): Promise<BridgeExecution> {
  const { plan, receipt } = params.progress
  if (params.progress.next !== 'resume' || receipt.status !== 'SOURCE_SUBMISSION_PENDING') {
    throw new BridgeError('Bridge progress has no source submission to resume')
  }
  const route = resolveTransferRoute(registry, plan)
  const onSubmitted = params.onCheckpoint
    ? async (value: BridgeReceipt) => params.onCheckpoint?.(createBridgeCheckpoint(plan, value))
    : undefined

  if (route.sourceChain.family === 'aleo') {
    const serializedTransaction = receipt.protocolState.preparedTransaction
    if (typeof serializedTransaction !== 'string' || !serializedTransaction) {
      throw new BridgeError('Prepared Aleo recovery is missing its serialized transaction')
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(serializedTransaction)
    } catch (error) {
      throw new BridgeError('Prepared Aleo recovery contains an invalid serialized transaction', { cause: error })
    }
    const transactionId = decoded && typeof decoded === 'object'
      ? (decoded as { id?: unknown }).id
      : undefined
    if (typeof transactionId !== 'string' || transactionId !== receipt.id) {
      throw new BridgeError('Prepared Aleo recovery transaction id does not match its payload')
    }
    try {
      const submittedId = await requireAleoClient(
        registry,
        clients,
        route.sourceChain.id,
      ).publicClient.request({
        method: 'sendTransaction',
        params: { transaction: serializedTransaction },
      }) as string
      if (submittedId !== transactionId) {
        throw new BridgeError(`Aleo node returned transaction id ${submittedId}; expected ${transactionId}`)
      }
    } catch (error) {
      if (error instanceof BridgeError) throw error
      const classified = classifyBroadcastError(error, transactionId)
      // Re-broadcasting the identical prepared transaction after a crash is
      // idempotent: the ledger's duplicate response means submission won the
      // race with the process failure.
      if (!(classified instanceof DuplicateTransactionError)) throw classified
    }
    const submitted: BridgeReceipt = {
      id: transactionId,
      protocol: plan.protocol,
      status: 'SOURCE_CONFIRMING',
      sourceTxId: transactionId,
      protocolState: {
        routeId: plan.route.id,
        ...(typeof receipt.protocolState.destinationBalanceBeforeAtomic === 'string'
          ? { destinationBalanceBeforeAtomic: receipt.protocolState.destinationBalanceBeforeAtomic }
          : {}),
        ...(typeof receipt.protocolState.expectedDestinationIncreaseAtomic === 'string'
          ? { expectedDestinationIncreaseAtomic: receipt.protocolState.expectedDestinationIncreaseAtomic }
          : {}),
      },
    }
    await onSubmitted?.(submitted)
    return plan.protocol === 'hyperlane'
      ? { kind: 'aleo-hyperlane', transactionId, receipt: submitted }
      : { kind: 'aleo-xreserve', transactionId, receipt: submitted }
  }

  if (route.route.protocol === 'xreserve' && route.sourceChain.family === 'evm') {
    const execution = await evmToAleoXReserve.execute(
      registry,
      requireEvmClientWithWallet(registry, clients, route.sourceChain.id, 'resume xReserve transfer'),
      {
        plan,
        resume: receipt,
        pollingIntervalMs: params.pollingIntervalMs,
        confirmationTimeoutMs: params.confirmationTimeoutMs,
        onSubmitted,
        privateMintSecretNonce: params.privateMintSecretNonce,
      },
    )
    return { kind: 'evm-xreserve', ...execution }
  }
  if (route.route.protocol === 'hyperlane' && route.sourceChain.family === 'evm') {
    const execution = await evmHyperlane.execute(
      registry,
      requireEvmClientWithWallet(registry, clients, route.sourceChain.id, 'resume Hyperlane transfer'),
      {
        plan,
        recipientBytes32: aleoAddressToBytes32(plan.recipient),
        resume: receipt,
        pollingIntervalMs: params.pollingIntervalMs,
        confirmationTimeoutMs: params.confirmationTimeoutMs,
        onSubmitted,
      },
    )
    return { kind: 'evm-hyperlane', ...execution }
  }
  throw new BridgeError('Source resumption is not implemented for this bridge route')
}
