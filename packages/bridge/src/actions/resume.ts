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
 * Submits the source-chain transaction left unfinished after an interruption.
 *
 * This applies when a token approval succeeded without the following deposit,
 * or an Aleo transaction was fully proved before the application stopped. Only
 * the pending submission continues. A proved Aleo transaction may be
 * rebroadcast byte-for-byte with the same transaction identifier, so recovery
 * cannot create a second transfer.
 *
 * The action may request authorization from the source wallet. A submitted
 * transaction can commit funds and incur a network fee.
 *
 * @param registry Supported chains, assets, and bridge provider deployments.
 * @param clients Network and wallet access for the source chain.
 * @param params Recovered transfer state, confirmation controls, and an optional callback for saving the new submission.
 * @returns The submitted transaction identifier and the updated state of the in-progress transfer.
 * @throws BridgeError When no source transaction remains to be submitted, required wallet access is unavailable, or submission fails.
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
    // This checkpoint was written after proving and before broadcast. Validate
    // that the serialized transaction carries the saved id before sending bytes
    // to the node; recovery must not substitute or rebuild a transaction.
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
    // Once broadcast succeeds (or the node reports the same transaction as a
    // duplicate), discard the serialized bytes and retain only public tracking state.
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
    // The EVM protocol helper accepts only approval-complete state here and
    // requotes allowance, fees, and private hook data before depositing.
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
    // Hyperlane follows the same approval-complete boundary: the saved approval
    // is observed, while the source dispatch is newly authorized once.
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
