import type { WalletClient } from '@veil/core'
import type {
  BridgeClient,
  BridgeOrderStage,
  BridgeOrderStatusDto,
  BridgeQuote,
  SwapReturnType,
} from '@veil/bridge'
import type { AleoAssetSymbol, ExternalAsset, ExternalChain } from '../chains.js'

export type FundOutParameters = {
  bridge: BridgeClient
  aleoWallet: WalletClient
  /** Source asset on the Aleo side. Determines which Aleo program is used for the unshield deposit. */
  sourceAsset: AleoAssetSymbol
  /** Destination chain, asset, and address on the external chain. */
  destination: {
    chain: ExternalChain
    asset: ExternalAsset | 'ETH' | 'SOL'
    address: string
    amount: string
  }
  /** Merkle proof input. Required only for compliance-bearing source assets (USDCX, USAD). */
  merkleProof?: string
  selectQuote?:
    | 'best'
    | 'fastest'
    | ((quotes: BridgeQuote[]) => BridgeQuote | Promise<BridgeQuote>)
  poll?: boolean | BridgeOrderStage
  timezone?: string
  onStage?: (status: BridgeOrderStatusDto) => void
}

export type FundOutResult = SwapReturnType

export async function fundOut(params: FundOutParameters): Promise<FundOutResult> {
  return params.bridge.swap({
    wallet: params.aleoWallet,
    from: { asset: params.sourceAsset, amount: params.destination.amount },
    to: {
      chain: params.destination.chain,
      asset: params.destination.asset,
      address: params.destination.address,
    },
    merkleProof: params.merkleProof,
    selectQuote: params.selectQuote,
    poll: params.poll,
    timezone: params.timezone,
    onStage: params.onStage,
  })
}
