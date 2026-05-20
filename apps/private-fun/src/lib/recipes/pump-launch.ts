import type { WalletClient } from '@veil/core'
import type { BridgeClient, BridgeOrderStatusDto } from '@veil/bridge'
import { fundOut } from './fund-out.js'

export type PumpMetadata = {
  name: string
  symbol: string
  imageUri: string
  description?: string
}

export type PumpCreator = {
  publicKey: string
  signTransaction: (...args: unknown[]) => Promise<unknown>
}

export type LaunchWithCreatorResult = {
  tokenMint: string
  solanaTxSignature: string
}

export type LaunchWithCreator = (input: {
  creator: PumpCreator
  metadataUri: string
  metadata: PumpMetadata
  initialBuySol: string
}) => Promise<LaunchWithCreatorResult>

export type PinMetadata = (metadata: PumpMetadata) => Promise<string>

export type PumpLaunchParameters = {
  bridge: BridgeClient
  aleoWallet: WalletClient
  creator: PumpCreator
  totalSol: string
  initialBuySol: string
  metadata: PumpMetadata
  /** Pins the metadata JSON to IPFS and returns the URI. Injected so tests can mock. */
  pinMetadata: PinMetadata
  /** Builds + signs the pump.fun createAndBuyInstructions tx. Injected so tests can mock. */
  launchWithCreator: LaunchWithCreator
  onStage?: (status: BridgeOrderStatusDto) => void
}

export type PumpLaunchResult = {
  tokenMint: string
  creatorAddress: string
  pumpfunUrl: string
  bridgeOrderId: string
  solanaTxSignature: string
}

export async function pumpLaunch(params: PumpLaunchParameters): Promise<PumpLaunchResult> {
  const metadataUri = await params.pinMetadata(params.metadata)

  const swap = await fundOut({
    bridge: params.bridge,
    aleoWallet: params.aleoWallet,
    sourceAsset: 'ALEO',
    destination: {
      chain: 'solana',
      asset: 'SOL',
      address: params.creator.publicKey,
      amount: params.totalSol,
    },
    poll: 'COMPLETED',
    onStage: params.onStage,
  })

  const launch = await params.launchWithCreator({
    creator: params.creator,
    metadataUri,
    metadata: params.metadata,
    initialBuySol: params.initialBuySol,
  })

  return {
    tokenMint: launch.tokenMint,
    creatorAddress: params.creator.publicKey,
    pumpfunUrl: `https://pump.fun/coin/${launch.tokenMint}`,
    bridgeOrderId: swap.orderId,
    solanaTxSignature: launch.solanaTxSignature,
  }
}
