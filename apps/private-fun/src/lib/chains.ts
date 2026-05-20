/**
 * Asset and chain metadata for the private.fun UI. The values here drive the
 * chain/asset pickers; the bridge API ultimately decides which routes have
 * live quotes at any moment.
 */

export type ExternalChain = 'solana' | 'ethereum' | 'base' | 'arbitrum'

export type ExternalAsset =
  | 'SOL'
  | 'ETH'
  | 'USDC'
  | 'USDT'
  | 'WBTC'

export type AleoAssetSymbol = 'ALEO' | 'WBTC' | 'WETH' | 'WUSDC' | 'WSOL' | 'USDCX' | 'USAD'

export type ChainConfig = {
  symbol: ExternalChain
  displayName: string
  /** EVM chain id; null for non-EVM. */
  evmChainId: number | null
  /** Explorer URL prefix; concat with tx hash for a deep link. */
  explorerTxPrefix: string
  /** Supported assets on this chain that the bridge can route. */
  assets: ExternalAsset[]
}

export const CHAIN_CONFIGS: Readonly<Record<ExternalChain, ChainConfig>> = Object.freeze({
  solana: {
    symbol: 'solana',
    displayName: 'Solana',
    evmChainId: null,
    explorerTxPrefix: 'https://solscan.io/tx/',
    assets: ['SOL', 'USDC'],
  },
  ethereum: {
    symbol: 'ethereum',
    displayName: 'Ethereum',
    evmChainId: 1,
    explorerTxPrefix: 'https://etherscan.io/tx/',
    assets: ['ETH', 'USDC', 'USDT', 'WBTC'],
  },
  base: {
    symbol: 'base',
    displayName: 'Base',
    evmChainId: 8453,
    explorerTxPrefix: 'https://basescan.org/tx/',
    assets: ['ETH', 'USDC', 'USDT', 'WBTC'],
  },
  arbitrum: {
    symbol: 'arbitrum',
    displayName: 'Arbitrum',
    evmChainId: 42161,
    explorerTxPrefix: 'https://arbiscan.io/tx/',
    assets: ['USDC', 'USDT', 'WBTC'],
  },
})

// Provable's Aleo explorer (https://explorer.provable.com). Verified URL from
// ProvableHQ's docs/examples; meant for browser viewing (not an API).
export const ALEO_EXPLORER_TX_PREFIX = 'https://explorer.provable.com/transaction/'

/** Map an Aleo-side asset symbol to the matching external asset for sanity-check pairing. */
export const ALEO_TO_EXTERNAL_ASSET: Readonly<Record<AleoAssetSymbol, ExternalAsset | 'ALEO'>> = Object.freeze({
  ALEO: 'ALEO',
  WBTC: 'WBTC',
  WETH: 'ETH',
  WUSDC: 'USDC',
  WSOL: 'SOL',
  USDCX: 'USDC',
  USAD: 'USDC',
})
