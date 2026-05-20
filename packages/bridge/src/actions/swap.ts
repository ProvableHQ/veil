import { transfer, type Client, type WalletClient } from '@veil/core'
import { getQuotes } from './getQuotes.js'
import { createOrder } from './createOrder.js'
import { waitForOrder } from './waitForOrder.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import { aleoAssetProgram, type AleoAssetConfig } from '../lib/aleo-asset.js'
import type { BridgeOrderStage, BridgeOrderStatusDto, BridgeQuote } from '../types/bridge.js'

export type SwapParameters = {
  /** @veil/core WalletClient used to sign the Aleo unshield deposit. */
  wallet: WalletClient
  /** Source side of the swap (Aleo is hardcoded as srcChain). */
  from: { asset: string; amount: string }
  /** Destination side. */
  to: { chain: string; asset: string; address: string }
  /** Required only when the source asset's Aleo program requires a merkle proof
   *  (e.g. USDCX, USAD). Pre-formatted as a single Aleo input string matching
   *  the program's `[MerkleProof; 2u32].private` shape. */
  merkleProof?: string | undefined
  /** Override the default asset → Aleo program map. */
  aleoAssetMap?: Readonly<Record<string, AleoAssetConfig>> | undefined
  selectQuote?:
    | 'best'
    | 'fastest'
    | ((quotes: BridgeQuote[]) => BridgeQuote | Promise<BridgeQuote>)
    | undefined
  /** false → return after deposit submission; true → wait for COMPLETED; specific stage → wait for that. */
  poll?: boolean | BridgeOrderStage | undefined
  timezone?: string | undefined
  onStage?: ((status: BridgeOrderStatusDto) => void) | undefined
}

export type SwapReturnType = {
  quoteRequestId: string
  orderId: string
  /** Aleo transaction id (`at1...`) for the unshield deposit transition. */
  depositTxId: string
  /** Present iff `poll` was truthy. */
  finalStatus?: BridgeOrderStatusDto
}

const SRC_CHAIN = 'aleo' as const

async function pickQuote(
  strategy: SwapParameters['selectQuote'],
  quotes: BridgeQuote[],
): Promise<BridgeQuote> {
  if (typeof strategy === 'function') return strategy(quotes)
  if (strategy === 'fastest') {
    return [...quotes].sort(
      (a, b) =>
        (a.estimatedTimeSeconds ?? Number.POSITIVE_INFINITY) -
        (b.estimatedTimeSeconds ?? Number.POSITIVE_INFINITY),
    )[0] as BridgeQuote
  }
  // 'best' (default): maximize amountOut
  return [...quotes].sort((a, b) => Number(b.amountOut) - Number(a.amountOut))[0] as BridgeQuote
}

export async function swap(
  client: Client,
  params: SwapParameters,
): Promise<SwapReturnType> {
  if (!params.wallet.account) {
    throw new BridgeError('swap requires a wallet client with an account')
  }
  const walletAddress = params.wallet.account.address

  const { quotes, meta } = await getQuotes(client, {
    srcChain: SRC_CHAIN,
    srcAsset: params.from.asset,
    destChain: params.to.chain,
    destAsset: params.to.asset,
    amountIn: params.from.amount,
    recipientAddress: params.to.address,
  })

  if (quotes.length === 0) {
    throw new BridgeError('Bridge returned no quotes for the requested route')
  }

  const chosen = await pickQuote(params.selectQuote ?? 'best', quotes)

  if (!chosen.quoteId) {
    throw new BridgeError('Selected bridge quote is missing quoteId')
  }

  const instructions = await createOrder(client, {
    providerId: chosen.provider.id,
    srcChain: SRC_CHAIN,
    destChain: params.to.chain,
    srcAsset: params.from.asset,
    destAsset: params.to.asset,
    amountIn: params.from.amount,
    walletAddress,
    quoteId: chosen.quoteId,
    timezone: params.timezone,
  })

  if (!instructions.depositAddress || !instructions.depositAmount) {
    throw new BridgeError('Bridge order is missing depositAddress or depositAmount')
  }

  const assetConfig = aleoAssetProgram(params.from.asset, params.aleoAssetMap)

  if (assetConfig.requiresMerkleProof && !params.merkleProof) {
    throw new BridgeError(
      `swap source asset ${params.from.asset} requires merkleProof; pass via SwapParameters.merkleProof`,
    )
  }

  const depositTxId = await transfer(params.wallet, {
    asset: assetConfig.program,
    to: instructions.depositAddress,
    amount: BigInt(instructions.depositAmount),
    visibility: 'unshield',
    merkleProof: params.merkleProof,
  })

  if (!params.poll) {
    return {
      quoteRequestId: meta.quoteRequestId,
      orderId: instructions.orderId,
      depositTxId,
    }
  }

  const finalStatus = await waitForOrder(client, {
    id: instructions.orderId,
    until: typeof params.poll === 'string' ? params.poll : 'COMPLETED',
    onStage: params.onStage,
  })

  return {
    quoteRequestId: meta.quoteRequestId,
    orderId: instructions.orderId,
    depositTxId,
    finalStatus,
  }
}
