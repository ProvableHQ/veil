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
import { readDestinationBalance } from './internal/readDestinationBalance.js'
import { readHyperlaneDelivery } from '../utils/hyperlaneDelivery.js'

function withoutNextAction(receipt: BridgeReceipt): Omit<BridgeReceipt, 'nextAction'> {
  const { nextAction: _nextAction, ...rest } = receipt
  return rest
}

/**
 * Checks one stage of an in-progress cross-chain transfer.
 *
 * The action checks the relevant source chain, bridge provider, or destination
 * chain once. The result advances when that stage has completed and otherwise
 * remains unchanged, which suits refresh buttons and scheduled background jobs.
 *
 * The action does not request a signature, submit a transaction, or move funds.
 *
 * @param registry Supported chains, assets, and bridge provider deployments.
 * @param clients Network access for the chains involved in the transfer.
 * @param client HTTP access for bridge provider status checks.
 * @param params Transfer details, latest receipt, and optional cancellation signal.
 * @returns The latest known state after one network or provider check.
 * @throws BridgeError When the receipt does not belong to the transfer, required network access is unavailable, or a provider returns invalid data.
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
    // Approval does not move bridge funds. Once confirmed, stop at an explicit
    // wallet boundary so an application can decide when to submit the deposit.
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
    // Aleo acceptance is the irreversible source boundary. Rejection is a
    // terminal source failure; an unresolved transaction remains observable.
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
    // EVM Hyperlane confirmation also verifies the dispatch event and extracts
    // the message id used for canonical destination Mailbox checks.
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
    // Solana confirmation reads the Mailbox log for the same cross-chain
    // message id after the signature reaches confirmed or finalized status.
    return getSolanaHyperlaneSourceStatus(
      requireSolanaClient(registry, clients, route.sourceChain.id),
      receipt,
    )
  }

  if (receipt.status === 'DELIVERY_PENDING'
    && route.route.protocol === 'hyperlane'
    && receipt.messageId
    && (route.destinationChain.family === 'aleo' || route.destinationChain.family === 'evm')) {
    // The destination Mailbox is the canonical delivery authority. Explorer
    // APIs are intentionally not used because indexing lag is not chain state.
    const destinationClient = route.destinationChain.family === 'aleo'
      ? requireAleoClient(registry, clients, route.destinationChain.id)
      : requireEvmClient(registry, clients, route.destinationChain.id)
    const mailbox = route.destinationChain.family === 'aleo'
      ? route.route.metadata?.aleoMailboxProgram
      : route.route.metadata?.mailboxAddress
    if (typeof mailbox !== 'string' || !mailbox) {
      throw new BridgeError(`Hyperlane destination mailbox is not configured for ${route.route.id}`)
    }
    const delivered = await readHyperlaneDelivery(destinationClient, { messageId: receipt.messageId, mailbox })
    if (!delivered) return receipt
    return { ...withoutNextAction(receipt), status: 'COMPLETED' }
  }

  if (receipt.status === 'DELIVERY_PENDING'
    && route.route.protocol === 'hyperlane'
    && route.sourceChain.family === 'aleo') {
    // Some Aleo-origin transfers do not expose a recoverable message id. For
    // those routes, compare the destination balance against the pre-submit
    // baseline captured by execute().
    const before = receipt.protocolState.destinationBalanceBeforeAtomic
    const expected = receipt.protocolState.expectedDestinationIncreaseAtomic
    if (typeof before !== 'string' || !/^\d+$/.test(before)
      || typeof expected !== 'string' || !/^\d+$/.test(expected)) {
      return receipt
    }
    const current = await readDestinationBalance(registry, clients, params.plan)
    if (current === undefined) {
      throw new BridgeError(`No supported destination balance verifier is configured for ${route.destinationChain.id}`)
    }
    if (current < BigInt(before) + BigInt(expected)) return receipt
    return { ...withoutNextAction(receipt), status: 'COMPLETED' }
  }

  if (receipt.status === 'DELIVERY_PENDING' && route.route.protocol === 'hyperlane') {
    return receipt
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
    // Circle's attestation authorizes destination minting. Public and record
    // delivery is provider-managed; private delivery must stop for an Aleo
    // wallet because only the recipient can submit the wrapper mint.
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
    // Private inbound xReserve is complete only after the recipient's Aleo mint
    // is accepted. A rejected mint fails delivery without changing the source deposit.
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
