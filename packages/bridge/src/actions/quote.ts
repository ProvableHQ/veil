import { BridgeError } from '../errors/bridgeErrors.js'
import {
  requireAleoClient,
  requireEvmClient,
  requireEvmClientWithWallet,
  requireSolanaClient,
  type BridgeChainClients,
} from '../connections/resolve.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type { QuoteParameters, BridgeQuote } from '../types/actions.js'
import { aleoAddressToBytes32 } from '../utils/xreserve.js'
import * as aleoHyperlane from '../protocols/hyperlane/aleo.js'
import * as evmHyperlane from '../protocols/hyperlane/evm.js'
import * as solanaHyperlane from '../protocols/hyperlane/solana.js'
import * as evmToAleoXReserve from '../protocols/xreserve/evmToAleo.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'
import { formatDecimalAmount, parseDecimalAmount } from '../utils/units.js'
import { prepare } from './prepare.js'

/**
 * Calculates the funds and fees required to begin a cross-chain transfer.
 *
 * The caller supplies the intended source, destination, amount, recipient, and
 * optional provider. The result includes both the validated transfer plan and
 * the bridge and network costs the selected provider can determine. Depending
 * on the route, it also reports the expected destination amount, wallet
 * balance, and token approval requirements.
 *
 * Routes with live pricing read current network and provider state; other routes
 * return their configured costs. The action does not request a wallet signature
 * or move funds.
 *
 * @param registry Supported chains, assets, and bridge provider deployments.
 * @param clients Network access for the chains involved in the transfer.
 * @param params Transfer details whose current cost and requirements are calculated.
 * @returns The amount expected at the destination and the known bridge, network, and approval costs.
 * @throws BridgeError When the selected provider cannot quote the transfer or required network access is unavailable.
 * @example const result = await quote(registry, clients, { source, destination, amount: '1', recipient })
 */
export async function quote(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  params: QuoteParameters,
): Promise<BridgeQuote> {
  // Build the canonical plan before reading live prices. The returned plan is
  // the exact value the caller passes to execution and stores in progress.
  const plan = prepare(registry, params)
  const protocolParams = {
    plan,
    privateMintSecretNonce: params.privateMintSecretNonce,
  }
  // Quote from the source side because that is where funds, approvals, and the
  // first network fee are paid. The validated route selects the protocol helper.
  const chain = resolveTransferRoute(registry, plan).sourceChain
  const chainId = chain.id

  if (plan.protocol === 'hyperlane' && chain.family === 'evm') {
    const client = requireEvmClient(registry, clients, chainId)
    const quote = await evmHyperlane.quote(registry, client, {
      plan,
      recipientBytes32: aleoAddressToBytes32(plan.recipient),
    })
    return { kind: 'evm-hyperlane', plan, ...quote }
  }
  if (plan.protocol === 'hyperlane' && chain.family === 'solana') {
    const quote = await solanaHyperlane.quote(
      registry,
      requireSolanaClient(registry, clients, chainId),
      protocolParams,
    )
    return { kind: 'solana-hyperlane', plan, ...quote }
  }
  if (plan.protocol === 'hyperlane' && chain.family === 'aleo') {
    const quote = await aleoHyperlane.quote(
      registry,
      requireAleoClient(registry, clients, chainId).publicClient,
      { routeId: plan.route.id },
    )
    return { kind: 'aleo-hyperlane', plan, ...quote }
  }
  if (plan.protocol === 'xreserve' && chain.family === 'evm') {
    const quote = await evmToAleoXReserve.quote(
      registry,
      requireEvmClientWithWallet(registry, clients, chainId, 'quote xReserve transfer'),
      protocolParams,
    )
    return { kind: 'evm-xreserve', plan, ...quote }
  }
  if (plan.protocol === 'xreserve' && chain.family === 'aleo') {
    // Aleo-origin xReserve has no provider quote endpoint. Its only known
    // bridge charge is the configured withdrawal fee, so report that fixed
    // deduction without pretending live state was queried.
    const rawFee = plan.route.metadata?.withdrawalFeeAtomic
    if (typeof rawFee !== 'string' || !/^\d+$/.test(rawFee)) {
      throw new BridgeError(`xReserve withdrawal fee is missing or invalid: ${plan.route.id}`)
    }
    const feeAtomic = BigInt(rawFee)
    const amountAtomic = parseDecimalAmount(plan.amountIn, plan.sourceAsset.decimals)
    const formattedFee = formatDecimalAmount(feeAtomic, plan.sourceAsset.decimals)
    if (amountAtomic <= feeAtomic) {
      throw new BridgeError(`xReserve burn amount must exceed the ${formattedFee} ${plan.sourceAsset.symbol} withdrawal fee`)
    }
    const amountOutAtomic = amountAtomic - feeAtomic
    return {
      kind: 'aleo-xreserve',
      plan,
      routeId: plan.route.id,
      protocol: 'xreserve',
      amountIn: plan.amountIn,
      amountOut: formatDecimalAmount(amountOutAtomic, plan.destinationAsset.decimals),
      fees: [
        ...plan.fees,
        {
          kind: 'protocol',
          chainId,
          assetId: plan.sourceAsset.id,
          amount: formattedFee,
          estimated: false,
        },
      ],
      status: 'not-queried',
    }
  }

  throw new BridgeError(`Unsupported ${plan.protocol} source chain family: ${chain.family}`)
}
