import type {
  BridgeClient,
  BridgeOrderInstructions,
  BridgeOrderStage,
  BridgeOrderStatusDto,
  BridgeQuote,
} from '@veil/bridge'
import type { AleoAssetSymbol, ExternalAsset, ExternalChain } from '../chains.js'

export type BridgeInParameters = {
  bridge: BridgeClient
  source: {
    chain: ExternalChain
    asset: ExternalAsset | 'ETH' | 'SOL'
    /** Source-chain address (the external wallet that will sign the deposit). */
    address: string
    amount: string
  }
  /** Aleo-side asset to receive (e.g. WSOL for inbound SOL). */
  destinationAsset: AleoAssetSymbol
  /** Aleo address that will own the shielded record. */
  recipientAleoAddress: string
  /** Quote selection strategy; defaults to 'best'. */
  selectQuote?:
    | 'best'
    | 'fastest'
    | ((quotes: BridgeQuote[]) => BridgeQuote | Promise<BridgeQuote>)
  timezone?: string
}

export type BridgeInResult = {
  quote: BridgeQuote
  instructions: BridgeOrderInstructions
  /** Resolves when the bridge order reaches `until` (default COMPLETED). */
  waitForCompletion: (until?: BridgeOrderStage) => Promise<BridgeOrderStatusDto>
}

async function pickQuote(
  strategy: BridgeInParameters['selectQuote'],
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
  return [...quotes].sort((a, b) => Number(b.amountOut) - Number(a.amountOut))[0] as BridgeQuote
}

export async function bridgeIn(params: BridgeInParameters): Promise<BridgeInResult> {
  const { quotes } = await params.bridge.getQuotes({
    srcChain: params.source.chain,
    srcAsset: params.source.asset,
    destChain: 'aleo',
    destAsset: params.destinationAsset,
    amountIn: params.source.amount,
    recipientAddress: params.recipientAleoAddress,
  })
  if (quotes.length === 0) {
    throw new Error('bridgeIn: no quotes returned for the requested route')
  }
  const chosen = await pickQuote(params.selectQuote ?? 'best', quotes)
  if (!chosen.quoteId) {
    throw new Error('bridgeIn: selected quote is missing quoteId')
  }

  const instructions = await params.bridge.createOrder({
    providerId: chosen.provider.id,
    srcChain: params.source.chain,
    destChain: 'aleo',
    srcAsset: params.source.asset,
    destAsset: params.destinationAsset,
    amountIn: params.source.amount,
    walletAddress: params.source.address,
    quoteId: chosen.quoteId,
    timezone: params.timezone,
  })

  return {
    quote: chosen,
    instructions,
    waitForCompletion: (until?: BridgeOrderStage) =>
      params.bridge.waitForOrder({ id: instructions.orderId, until: until ?? 'COMPLETED' }),
  }
}
