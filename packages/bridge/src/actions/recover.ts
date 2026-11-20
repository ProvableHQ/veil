import { hyperlaneRecipient, privateClaimStatus, readHyperlaneClaimableAmount } from '../protocols/hyperlane/privateMint.js'
import { isTransferId, planSubject, withBridgeContext } from './internal/clientContext.js'
import { isRegistryVersionCompatible } from '../registry/compatibility.js'
import * as cctp from '../protocols/cctp/evm.js'
import * as verulink from '../protocols/verulink/lifecycle.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import { requireEvmClient, type BridgeChainClients } from '../connections/resolve.js'
import type { RecoverParameters } from '../types/actions.js'
import type { BridgePlan, BridgeProgress, BridgeReceipt, BridgeRegistry } from '../types/protocol.js'
import type { XReserveHttpTransport } from '../types/xreserve.js'
import { recoverSourceCheckpoint } from '../protocols/xreserve/evmToAleo.js'
import { recoverSourceCheckpoint as recoverEvmHyperlaneSource } from '../protocols/hyperlane/evm.js'
import { getStatus } from './getStatus.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'
import { prepare } from './prepare.js'
import { toBridgeProgress } from './internal/toBridgeProgress.js'
import { resolveCircleOptions } from './internal/circleOptions.js'
import { parseDecimalAmount } from '../utils/units.js'

/**
 * Reconstructs an interrupted cross-chain transfer from a saved checkpoint.
 *
 * The action determines which transactions were submitted, which stages have
 * completed, and whether the transfer is still moving, finished, failed, or
 * waiting for another wallet authorization.
 *
 * Private Hyperlane recovery reads the Aleo claimable mapping even when source
 * transaction identifiers are unavailable. Other protocols read their existing
 * network and provider state. Recovery never repeats a
 * transaction or moves funds.
 *
 * @param registry Supported chains, assets, and bridge provider deployments.
 * @param clients Network access for the chains involved in the transfer.
 * @param client HTTP access for bridge provider status checks.
 * @param params Saved route, amount, recipient, and submitted transaction identifiers.
 * @returns The current transfer state and whether to wait, resume source submission, authorize destination completion, or stop.
 * @throws BridgeError When the saved information is invalid, no longer matches the configured route, or describes an unsupported recovery path.
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
  // Rebuild route details from the current reviewed catalog instead of trusting
  // serialized contracts or programs from an older application process.
  const plan = {
    ...prepare(registry, checkpoint.intent),
    ...(isTransferId(checkpoint.transferId) ? { transferId: checkpoint.transferId } : {}),
  }
  clients = withBridgeContext(clients, 'recover', planSubject(plan))
  const route = resolveTransferRoute(registry, plan)
  if (checkpoint.version !== 1
    || checkpoint.route.id !== plan.route.id
    || !isRegistryVersionCompatible(registry, checkpoint.route.registryVersion, checkpoint.route.id)) {
    throw new BridgeError('Bridge checkpoint does not match the prepared route')
  }
  const { approvalReplacement } = resolveCircleOptions(params, { approvalReplacement: params.cctp?.approvalReplacement })
  if (plan.protocol === 'cctp') {
    const receipt = await cctp.recover(registry, clients, client, {
      checkpoint, plan, signal: params.signal, cctp: approvalReplacement ? { approvalReplacement } : undefined,
    })
    return toBridgeProgress(plan, receipt)
  }
  if (approvalReplacement) throw new BridgeError('CCTP recovery options require a CCTP route')
  if (plan.protocol === 'verulink') return toBridgeProgress(plan, await verulink.recover(registry, clients, client, { checkpoint, plan, signal: params.signal }))
  // Private Hyperlane deposits can be recovered from their destination mapping
  // even if source history, a message id, or the source checkpoint was lost.
  if (plan.protocol === 'hyperlane' && plan.mintMode === 'private'
    && (clients[route.destinationChain.id] || !checkpoint.source || checkpoint.destination)) {
    const mapped = await recoverPrivateClaimFromMapping(registry, clients, params, plan)
    if (mapped) return toBridgeProgress(plan, mapped)
  }
  let receipt: BridgeReceipt
  if (route.sourceChain.family === 'aleo') {
    // Aleo can checkpoint after proving but before broadcast. This state needs
    // no network read: resume() can submit the exact immutable transaction.
    const deliveryVerification = checkpoint.deliveryVerification
      ? {
          destinationBalanceBeforeAtomic: checkpoint.deliveryVerification.balanceBeforeAtomic,
          expectedDestinationIncreaseAtomic: checkpoint.deliveryVerification.expectedIncreaseAtomic,
        }
      : {}
    const prepared = checkpoint.source?.preparedTransaction
    if (prepared && !checkpoint.source?.transactionId) {
      if (checkpoint.destination || (checkpoint.source?.approvalTransactionIds?.length ?? 0) > 0) {
        throw new BridgeError('Bridge checkpoint contains transactions that are invalid for a prepared Aleo source route')
      }
      let decoded: unknown
      try {
        decoded = JSON.parse(prepared.serializedTransaction)
      } catch (error) {
        throw new BridgeError('Bridge checkpoint contains an invalid prepared Aleo transaction', { cause: error })
      }
      if (!decoded || typeof decoded !== 'object'
        || (decoded as { id?: unknown }).id !== prepared.transactionId) {
        throw new BridgeError('Bridge checkpoint prepared Aleo transaction id does not match its payload')
      }
      return toBridgeProgress(plan, {
        id: prepared.transactionId,
        protocol: plan.protocol,
        status: 'SOURCE_SUBMISSION_PENDING',
        protocolState: {
          routeId: checkpoint.route.id,
          preparedTransaction: prepared.serializedTransaction,
          ...deliveryVerification,
        },
      })
    }
    if (!checkpoint.source?.transactionId) {
      throw new BridgeError('Bridge checkpoint contains no submitted source transaction')
    }
    if (checkpoint.destination || (checkpoint.source.approvalTransactionIds?.length ?? 0) > 0) {
      throw new BridgeError('Bridge checkpoint contains transactions that are invalid for an Aleo source route')
    }
    // A submitted Aleo source transaction is never rebroadcast during recovery;
    // inspect its ledger status once and expose the next caller operation.
    receipt = await getStatus(registry, clients, client, {
      plan,
      receipt: {
        id: checkpoint.source.transactionId,
        protocol: plan.protocol,
        status: 'SOURCE_CONFIRMING',
        sourceTxId: checkpoint.source.transactionId,
        protocolState: { routeId: checkpoint.route.id, ...deliveryVerification },
      },
      signal: params.signal,
    })
    return toBridgeProgress(plan, receipt)
  }
  if (route.sourceChain.family === 'solana') {
    // Solana has one source transaction and no approval phase. Recovery only
    // checks the saved signature and rejects impossible destination state.
    if (!checkpoint.source?.transactionId) {
      throw new BridgeError('Bridge checkpoint contains no submitted source transaction')
    }
    if ((checkpoint.destination && plan.mintMode !== 'private') || (checkpoint.source.approvalTransactionIds?.length ?? 0) > 0) {
      throw new BridgeError('Bridge checkpoint contains transactions that are invalid for a Solana source route')
    }
    const { blockhash, lastValidBlockHeight } = checkpoint.source
    if ((blockhash !== undefined || lastValidBlockHeight !== undefined)
      && (typeof blockhash !== 'string' || !blockhash
        || typeof lastValidBlockHeight !== 'string' || !/^\d+$/.test(lastValidBlockHeight))) {
      throw new BridgeError('Bridge checkpoint contains an invalid Solana blockhash lifetime')
    }
    receipt = await getStatus(registry, clients, client, {
      plan,
      receipt: {
        id: checkpoint.source.transactionId,
        protocol: plan.protocol,
        status: 'SOURCE_CONFIRMING',
        sourceTxId: checkpoint.source.transactionId,
        protocolState: {
          routeId: checkpoint.route.id,
          ...(typeof blockhash === 'string' && typeof lastValidBlockHeight === 'string'
            ? { blockhash, lastValidBlockHeight }
            : {}),
        },
      },
      signal: params.signal,
    })
    return toBridgeProgress(plan, await recoveredPrivateClaim(registry, clients, client, params, plan, receipt))
  }
  if (route.route.protocol === 'hyperlane' && route.sourceChain.family === 'evm') {
    // EVM Hyperlane may have one or more token approvals before its dispatch.
    // The protocol helper determines which submitted boundary was reached.
    if (checkpoint.destination && plan.mintMode !== 'private') {
      throw new BridgeError('Bridge checkpoint contains a destination transaction that is invalid for this Hyperlane route')
    }
    receipt = await recoverEvmHyperlaneSource(
      registry,
      requireEvmClient(registry, clients, route.sourceChain.id),
      plan,
      hyperlaneRecipient(registry, plan),
      checkpoint,
    )
    return toBridgeProgress(plan, await recoveredPrivateClaim(registry, clients, client, params, plan, receipt))
  }
  if (route.route.protocol !== 'xreserve'
    || route.sourceChain.family !== 'evm'
    || route.destinationChain.family !== 'aleo') {
    throw new BridgeError('Bridge checkpoint recovery is not implemented for this route')
  }
  // EVM xReserve likewise separates token approval from the irreversible
  // deposit, then may add a caller-authorized private mint on Aleo.
  receipt = await recoverSourceCheckpoint(
    registry,
    requireEvmClient(registry, clients, route.sourceChain.id),
    plan,
    checkpoint,
  )
  const preparedDestination = checkpoint.destination?.preparedTransaction
  // A destination transaction is either proved or submitted, never both.
  // Keeping those states exclusive prevents recovery from minting twice.
  if (preparedDestination && checkpoint.destination?.transactionId) {
    throw new BridgeError('Bridge checkpoint cannot contain both prepared and submitted destination transactions')
  }
  if (preparedDestination) {
    let decoded: unknown
    try {
      decoded = JSON.parse(preparedDestination.serializedTransaction)
    } catch (error) {
      throw new BridgeError('Bridge checkpoint contains an invalid prepared Aleo destination transaction', { cause: error })
    }
    if (!decoded || typeof decoded !== 'object'
      || (decoded as { id?: unknown }).id !== preparedDestination.transactionId) {
      throw new BridgeError('Bridge checkpoint prepared Aleo destination transaction id does not match its payload')
    }
  }
  if (checkpoint.destination?.transactionId) {
    // A submitted private mint is observed as destination confirmation; it is
    // never routed back through the wallet.
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
  if (preparedDestination) {
    // Preserve the proved transaction only while Circle's attestation still
    // requires the same private destination action.
    if (receipt.status !== 'DESTINATION_ACTION_REQUIRED') {
      throw new BridgeError('Prepared destination transaction is no longer valid for the recovered bridge state')
    }
    receipt = {
      ...receipt,
      id: preparedDestination.transactionId,
      protocolState: {
        ...receipt.protocolState,
        preparedDestinationTransaction: preparedDestination.serializedTransaction,
      },
    }
  }
  return toBridgeProgress(plan, receipt)
}

/** Restores an already submitted private claim without requesting another signature. */
async function recoveredPrivateClaim(
  registry: BridgeRegistry, clients: BridgeChainClients, client: XReserveHttpTransport,
  params: RecoverParameters, plan: BridgePlan, receipt: BridgeReceipt,
): Promise<BridgeReceipt> {
  if (plan.protocol !== 'hyperlane' || plan.mintMode !== 'private') return receipt
  if (receipt.status !== 'DELIVERY_PENDING') return receipt
  return getStatus(registry, clients, client, { plan, receipt, signal: params.signal })
}

/** Recovers funded encodings or observes submitted claims using only Aleo state. */
async function recoverPrivateClaimFromMapping(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  params: RecoverParameters,
  plan: BridgePlan,
): Promise<BridgeReceipt | undefined> {
  const checkpoint = params.checkpoint
  hyperlaneRecipient(registry, plan)
  const destination = checkpoint.destination
  if (destination?.preparedTransaction || (destination && (typeof destination.transactionId !== 'string' || !destination.transactionId))) {
    throw new BridgeError('Hyperlane private recovery requires a submitted destination transaction id')
  }
  const approvals = checkpoint.source?.approvalTransactionIds
  if (approvals !== undefined && (!Array.isArray(approvals) || approvals.some(id => typeof id !== 'string'))) {
    throw new BridgeError('Hyperlane checkpoint contains invalid approval transaction identifiers')
  }
  const receipt: BridgeReceipt = {
    id: destination?.transactionId ?? checkpoint.source?.transactionId ?? plan.hyperlane!.addressEncoding.commitmentHex,
    protocol: 'hyperlane', status: 'DELIVERY_PENDING',
    ...(checkpoint.source?.transactionId ? { sourceTxId: checkpoint.source.transactionId } : {}),
    protocolState: { routeId: plan.route.id, ...(approvals ? { approvalTxIds: [...approvals] } : {}) },
  }
  params.signal?.throwIfAborted()
  if (destination?.transactionId) {
    // Observe an existing claim before looking for spendable funds, so an
    // unresolved transaction can never trigger a duplicate claim or dispatch.
    return privateClaimStatus(registry, clients, plan, { ...receipt, status: 'DESTINATION_CONFIRMING', destinationTxId: destination.transactionId })
  }
  const claimable = await readHyperlaneClaimableAmount(registry, clients, {
    routeId: plan.route.id, addressEncoding: plan.hyperlane!.addressEncoding,
  })
  params.signal?.throwIfAborted()
  // An absent entry can still mean an unsubmitted source approval. Preserve
  // existing source recovery in that case. A present zero entry proves only
  // prior recognition of this encoding, never completion or permission to resend.
  if (claimable === null && checkpoint.source && clients[plan.sourceAsset.chainId]) return undefined
  const destinationAsset = resolveTransferRoute(registry, plan).destinationAsset
  const amount = parseDecimalAmount(plan.amountIn, destinationAsset.decimals)
  return claimable !== null && claimable >= amount
    ? { ...receipt, status: 'DESTINATION_ACTION_REQUIRED' }
    : receipt
}
