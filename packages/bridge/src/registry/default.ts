import type {
  BridgeEnvironment,
  BridgeRegistry,
  ProtocolBridgeAsset,
  ProtocolBridgeChain,
  ProtocolBridgeRoute,
} from '../types/protocol.js'

const EVM_ADDRESS = '^0x[0-9a-fA-F]{40}$'
const SOLANA_ADDRESS = '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
const ALEO_ADDRESS = '^aleo1[0-9a-z]{58}$'

const chains: ProtocolBridgeChain[] = [
  { id: 'aleo', displayName: 'Aleo', family: 'aleo', environment: 'mainnet', nativeCurrencySymbol: 'ALEO', protocolDomains: { xreserve: 10002 } },
  { id: 'ethereum', displayName: 'Ethereum', family: 'evm', environment: 'mainnet', nativeCurrencySymbol: 'ETH', protocolDomains: { xreserve: 0 } },
  { id: 'solana', displayName: 'Solana', family: 'solana', environment: 'mainnet', nativeCurrencySymbol: 'SOL' },
  { id: 'base', displayName: 'Base', family: 'evm', environment: 'mainnet', nativeCurrencySymbol: 'ETH' },
  { id: 'hyperevm', displayName: 'HyperEVM', family: 'evm', environment: 'mainnet', nativeCurrencySymbol: 'HYPE' },
  { id: 'aleo-testnet', displayName: 'Aleo Testnet', family: 'aleo', environment: 'testnet', nativeCurrencySymbol: 'ALEO', protocolDomains: { xreserve: 10002 } },
  { id: 'sepolia', displayName: 'Ethereum Sepolia', family: 'evm', environment: 'testnet', nativeCurrencySymbol: 'ETH' },
]

const assets: ProtocolBridgeAsset[] = [
  { id: 'aleo/aleo', chainId: 'aleo', symbol: 'ALEO', name: 'Aleo', decimals: 6, kind: 'native', locator: { kind: 'aleo-program', value: 'credits.aleo' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/usdcx', chainId: 'aleo', symbol: 'USDCx', name: 'USDCx', decimals: 6, kind: 'token', locator: { kind: 'aleo-program', value: 'usdcx_stablecoin.aleo' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/eth', chainId: 'aleo', symbol: 'ETH', name: 'Hyperlane ETH', decimals: 18, kind: 'token', locator: { kind: 'aleo-program', value: 'token_registry.aleo' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/wbtc', chainId: 'aleo', symbol: 'WBTC', name: 'Hyperlane WBTC', decimals: 8, kind: 'token', locator: { kind: 'aleo-program', value: 'token_registry.aleo' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/sol', chainId: 'aleo', symbol: 'SOL', name: 'Hyperlane SOL', decimals: 9, kind: 'token', locator: { kind: 'aleo-program', value: 'token_registry.aleo' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/usad', chainId: 'aleo', symbol: 'USAD', name: 'USAD', decimals: 6, kind: 'token', locator: { kind: 'aleo-program', value: 'usad_stablecoin.aleo' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'ethereum/usdc', chainId: 'ethereum', symbol: 'USDC', name: 'USD Coin', decimals: 6, kind: 'token', locator: { kind: 'evm-contract', value: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/eth', chainId: 'ethereum', symbol: 'ETH', name: 'Ether', decimals: 18, kind: 'native', locator: { kind: 'native', value: 'ETH' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/wbtc', chainId: 'ethereum', symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, kind: 'token', addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/aleo', chainId: 'ethereum', symbol: 'ALEO', name: 'Hyperlane ALEO', decimals: 6, kind: 'token', addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/usad', chainId: 'ethereum', symbol: 'USAD', name: 'USAD route collateral', decimals: 6, kind: 'token', addressValidationRegex: EVM_ADDRESS },
  { id: 'solana/sol', chainId: 'solana', symbol: 'SOL', name: 'Solana', decimals: 9, kind: 'native', locator: { kind: 'native', value: 'SOL' }, addressValidationRegex: SOLANA_ADDRESS },
  { id: 'solana/aleo', chainId: 'solana', symbol: 'ALEO', name: 'Hyperlane ALEO', decimals: 6, kind: 'token', addressValidationRegex: SOLANA_ADDRESS },
  { id: 'base/aleo', chainId: 'base', symbol: 'ALEO', name: 'Hyperlane ALEO', decimals: 6, kind: 'token', addressValidationRegex: EVM_ADDRESS },
  { id: 'hyperevm/aleo', chainId: 'hyperevm', symbol: 'ALEO', name: 'Hyperlane ALEO', decimals: 6, kind: 'token', addressValidationRegex: EVM_ADDRESS },
  { id: 'aleo-testnet/usdcx', chainId: 'aleo-testnet', symbol: 'USDCx', name: 'Testnet USDCx', decimals: 6, kind: 'token', locator: { kind: 'aleo-program', value: 'test_usdcx_stablecoin.aleo' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'sepolia/usdc', chainId: 'sepolia', symbol: 'USDC', name: 'Testnet USD Coin', decimals: 6, kind: 'token', locator: { kind: 'evm-contract', value: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' }, addressValidationRegex: EVM_ADDRESS },
]

const XRESERVE_SOURCE = 'https://developers.circle.com/xreserve/references/supported-blockchains-and-domains'
const HYPERLANE_SOURCE = 'https://github.com/hyperlane-xyz/hyperlane-registry/tree/main/deployments/warp_routes'

function route(
  id: string,
  protocol: 'xreserve' | 'hyperlane',
  environment: BridgeEnvironment,
  sourceAssetId: string,
  destinationAssetId: string,
  availability: 'active' | 'metadata-required',
  deploymentId: string,
  metadata?: Readonly<Record<string, string | number | boolean>>,
): ProtocolBridgeRoute {
  return {
    id,
    protocol,
    environment,
    sourceAssetId,
    destinationAssetId,
    availability,
    deploymentId,
    source: protocol === 'xreserve' ? XRESERVE_SOURCE : HYPERLANE_SOURCE,
    ...(metadata == null ? {} : { metadata }),
  }
}

function pair(
  protocol: 'xreserve' | 'hyperlane',
  environment: BridgeEnvironment,
  left: string,
  right: string,
  availability: 'active' | 'metadata-required',
  deploymentId: string,
  metadata?: Readonly<Record<string, string | number | boolean>>,
): ProtocolBridgeRoute[] {
  return [
    route(`${protocol}:${left}->${right}`, protocol, environment, left, right, availability, deploymentId, metadata),
    route(`${protocol}:${right}->${left}`, protocol, environment, right, left, availability, deploymentId, metadata),
  ]
}

const routes: ProtocolBridgeRoute[] = [
  ...pair('xreserve', 'mainnet', 'ethereum/usdc', 'aleo/usdcx', 'active', 'xreserve-usdcx-aleo', {
    xReserveContract: '0x8888888199b2Df864bf678259607d6D5EBb4e3Ce',
    sourceDomain: 0,
    remoteDomain: 10002,
    remoteToken: 'usdcx_stablecoin.aleo',
  }),
  ...pair('xreserve', 'testnet', 'sepolia/usdc', 'aleo-testnet/usdcx', 'active', 'xreserve-usdcx-aleo-testnet', {
    xReserveContract: '0x008888878f94C0d87defdf0B07f46B93C1934442',
    sourceDomain: 0,
    remoteDomain: 10002,
    remoteToken: 'test_usdcx_stablecoin.aleo',
  }),
  ...pair('hyperlane', 'mainnet', 'ethereum/eth', 'aleo/eth', 'metadata-required', 'ETH/aleo'),
  ...pair('hyperlane', 'mainnet', 'ethereum/wbtc', 'aleo/wbtc', 'metadata-required', 'WBTC/aleo'),
  ...pair('hyperlane', 'mainnet', 'solana/sol', 'aleo/sol', 'metadata-required', 'SOL/aleo'),
  ...pair('hyperlane', 'mainnet', 'aleo/aleo', 'ethereum/aleo', 'metadata-required', 'ALEO/aleo'),
  ...pair('hyperlane', 'mainnet', 'aleo/aleo', 'solana/aleo', 'metadata-required', 'ALEO/aleo'),
  ...pair('hyperlane', 'mainnet', 'aleo/aleo', 'base/aleo', 'metadata-required', 'ALEO/aleo'),
  ...pair('hyperlane', 'mainnet', 'aleo/aleo', 'hyperevm/aleo', 'metadata-required', 'ALEO/aleo'),
  ...pair('hyperlane', 'mainnet', 'ethereum/usad', 'aleo/usad', 'metadata-required', 'USAD/aleo'),
]

/**
 * Supplies the initial reviewed protocol-route snapshot.
 *
 * xReserve contract identifiers are populated from Circle's published
 * mainnet and testnet tables. Hyperlane routes intentionally remain
 * `metadata-required` until their router, domain, ISM, and token identifiers
 * are pinned from one reviewed registry commit. Pure and local.
 *
 * @example
 * const bridge = createBridgeClient({ registry: DEFAULT_BRIDGE_REGISTRY })
 */
export const DEFAULT_BRIDGE_REGISTRY: BridgeRegistry = Object.freeze({
  version: '2026-08-13.foundation.1',
  chains: Object.freeze(chains),
  assets: Object.freeze(assets),
  routes: Object.freeze(routes),
  sources: Object.freeze([XRESERVE_SOURCE, HYPERLANE_SOURCE]),
})
