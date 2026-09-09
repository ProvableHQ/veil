import { BridgeError } from '../errors/bridgeErrors.js'
import {
  requireAleoClient,
  requireAleoClientWithWallet,
  requireEvmClientWithWallet,
  requireSolanaClientWithWallet,
  type BridgeChainClients,
} from '../connections/resolve.js'
import type { XReserveBurnMode } from '../types/aleo.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type { ExecuteParameters, BridgeExecution } from '../types/actions.js'
import { aleoAddressToBytes32 } from '../utils/xreserve.js'
import { executeAleoHyperlaneTransferRemote } from './executeAleoHyperlaneTransferRemote.js'
import { executeEvmHyperlaneTransfer } from './executeEvmHyperlaneTransfer.js'
import { executeEvmXReserveTransfer } from './executeEvmXReserveTransfer.js'
import { executeSolanaHyperlaneTransfer } from './executeSolanaHyperlaneTransfer.js'
import { executeXReserveBurn } from './executeXReserveBurn.js'
import { quoteAleoHyperlaneGasPayment } from './quoteAleoHyperlaneGasPayment.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'

function aleoHyperlaneMode(mode: ExecuteParameters['mode']): 'caller' | 'signer' | undefined {
  if (mode == null) return undefined
  if (mode === 'caller' || mode === 'signer') return mode
  throw new BridgeError(`Aleo Hyperlane does not support execution mode "${mode}"`)
}

function xReserveBurnMode(mode: ExecuteParameters['mode']): XReserveBurnMode | undefined {
  if (mode == null) return undefined
  if (mode === 'private' || mode === 'public' || mode === 'public-as-signer') return mode
  throw new BridgeError(`Aleo xReserve does not support execution mode "${mode}"`)
}

/**
 * Executes a prepared transfer through its configured protocol and source chain.
 *
 * Resolves the required wallet client from the plan and requotes live values
 * before submission. Supported checkpoint receipts resume observation without
 * resubmitting an irreversible source transaction.
 *
 * @param registry Reviewed deployment snapshot.
 * @param clients Materialized chain clients keyed by registry chain id.
 * @param params Prepared transfer, source execution settings, and optional checkpoint.
 * @returns A discriminated execution result containing normalized resumable state.
 * @throws BridgeError When the route shape, execution mode, client, or submission is invalid.
 * @example const execution = await execute(registry, clients, { plan, onSubmitted: saveCheckpoint })
 */
export async function execute(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  params: ExecuteParameters,
): Promise<BridgeExecution> {
  const chain = resolveTransferRoute(registry, params.plan).sourceChain
  const chainId = chain.id

  if (params.plan.protocol === 'hyperlane' && chain.family === 'evm') {
    const execution = await executeEvmHyperlaneTransfer(
      registry,
      requireEvmClientWithWallet(registry, clients, chainId, 'execute Hyperlane transfer'),
      {
        plan: params.plan,
        recipientBytes32: aleoAddressToBytes32(params.plan.recipient),
        pollingIntervalMs: params.pollingIntervalMs,
        confirmationTimeoutMs: params.confirmationTimeoutMs,
        resume: params.resume,
        onSubmitted: params.onSubmitted,
      },
    )
    return { kind: 'evm-hyperlane', ...execution }
  }
  if (params.plan.protocol === 'hyperlane' && chain.family === 'solana') {
    const execution = await executeSolanaHyperlaneTransfer(
      registry,
      requireSolanaClientWithWallet(registry, clients, chainId, 'execute Hyperlane transfer'),
      {
        plan: params.plan,
        pollingIntervalMs: params.pollingIntervalMs,
        confirmationTimeoutMs: params.confirmationTimeoutMs,
        resume: params.resume,
        onSubmitted: params.onSubmitted,
      },
    )
    return { kind: 'solana-hyperlane', ...execution }
  }
  if (params.plan.protocol === 'hyperlane' && chain.family === 'aleo') {
    if (params.resume) throw new BridgeError('Aleo Hyperlane execution does not support source receipt resumption')
    const client = requireAleoClientWithWallet(registry, clients, chainId, 'execute Hyperlane transfer')
    const gasPaymentMicrocredits = params.gasPaymentMicrocredits ?? (await quoteAleoHyperlaneGasPayment(
      registry,
      requireAleoClient(registry, clients, chainId).publicClient,
      { routeId: params.plan.route.id },
    )).paymentMicrocredits
    const execution = await executeAleoHyperlaneTransferRemote(registry, client.walletClient, {
      plan: params.plan,
      mode: aleoHyperlaneMode(params.mode),
      privateFee: params.privateFee,
      gasPaymentMicrocredits,
      onSubmitted: params.onSubmitted,
    })
    return { kind: 'aleo-hyperlane', ...execution }
  }
  if (params.plan.protocol === 'xreserve' && chain.family === 'evm') {
    const execution = await executeEvmXReserveTransfer(
      registry,
      requireEvmClientWithWallet(registry, clients, chainId, 'execute xReserve transfer'),
      {
        plan: params.plan,
        pollingIntervalMs: params.pollingIntervalMs,
        confirmationTimeoutMs: params.confirmationTimeoutMs,
        resume: params.resume,
        onSubmitted: params.onSubmitted,
      },
    )
    return { kind: 'evm-xreserve', ...execution }
  }
  if (params.plan.protocol === 'xreserve' && chain.family === 'aleo') {
    if (params.resume) throw new BridgeError('Aleo xReserve burn execution does not support source receipt resumption')
    const execution = await executeXReserveBurn(
      registry,
      requireAleoClientWithWallet(registry, clients, chainId, 'execute xReserve burn').walletClient,
      {
        plan: params.plan,
        mode: xReserveBurnMode(params.mode),
        userRecord: params.userRecord,
        merkleProof: params.merkleProof,
        privateFee: params.privateFee,
        onSubmitted: params.onSubmitted,
      },
    )
    return { kind: 'aleo-xreserve', ...execution }
  }

  throw new BridgeError(`Unsupported ${params.plan.protocol} source chain family: ${chain.family}`)
}
