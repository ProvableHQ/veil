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
  { id: 'aleo', displayName: 'Aleo', family: 'aleo', environment: 'mainnet', nativeCurrencySymbol: 'ALEO', protocolDomains: { xreserve: 10002, hyperlane: 1634493807 } },
  { id: 'ethereum', displayName: 'Ethereum', family: 'evm', environment: 'mainnet', nativeCurrencySymbol: 'ETH', protocolDomains: { xreserve: 0, hyperlane: 1 } },
  { id: 'solana', displayName: 'Solana', family: 'solana', environment: 'mainnet', nativeCurrencySymbol: 'SOL' },
  { id: 'base', displayName: 'Base', family: 'evm', environment: 'mainnet', nativeCurrencySymbol: 'ETH' },
  { id: 'hyperevm', displayName: 'HyperEVM', family: 'evm', environment: 'mainnet', nativeCurrencySymbol: 'HYPE' },
  { id: 'aleo-testnet', displayName: 'Aleo Testnet', family: 'aleo', environment: 'testnet', nativeCurrencySymbol: 'ALEO', protocolDomains: { xreserve: 10002, hyperlane: 1617853565 } },
  { id: 'sepolia', displayName: 'Ethereum Sepolia', family: 'evm', environment: 'testnet', nativeCurrencySymbol: 'ETH', protocolDomains: { hyperlane: 11155111 } },
]

const assets: ProtocolBridgeAsset[] = [
  { id: 'aleo/aleo', chainId: 'aleo', symbol: 'ALEO', name: 'Aleo', decimals: 6, kind: 'native', locator: { kind: 'aleo-program', value: 'credits.aleo' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/usdcx', chainId: 'aleo', symbol: 'USDCx', name: 'USDCx', decimals: 6, kind: 'token', locator: { kind: 'aleo-program', value: 'usdcx_stablecoin.aleo' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/eth', chainId: 'aleo', symbol: 'ETH', name: 'Hyperlane ETH', decimals: 18, kind: 'token', locator: { kind: 'aleo-program', value: 'hyp_warp_token_eth_v2.aleo', tokenId: 'aleo1t7f29tq9qng2lfvrkpcuvu59jn24hrmzqdyqfn6p0u5p80npfvqqecmkj8' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/wbtc', chainId: 'aleo', symbol: 'WBTC', name: 'Hyperlane WBTC', decimals: 8, kind: 'token', locator: { kind: 'aleo-program', value: 'hyp_warp_token_wbtc_v2.aleo', tokenId: 'aleo1240fsvz2dhmj0cdtt8mc0yc8um9fmu236rqcl2qnlj9703hd2vpsdwyrtf' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/usdt', chainId: 'aleo', symbol: 'USDT', name: 'Hyperlane USDT', decimals: 6, kind: 'token', locator: { kind: 'aleo-program', value: 'hyp_warp_token_usdt_v2.aleo', tokenId: 'aleo18yynfz0lrfx0tund540vy2z7gju7ekgqsueg5jgu28mpm2z42ufq7qua8y' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/sol', chainId: 'aleo', symbol: 'SOL', name: 'Hyperlane SOL', decimals: 9, kind: 'token', locator: { kind: 'aleo-program', value: 'token_registry.aleo' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/usad', chainId: 'aleo', symbol: 'USAD', name: 'USAD', decimals: 6, kind: 'token', locator: { kind: 'aleo-program', value: 'usad_stablecoin.aleo' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'ethereum/usdc', chainId: 'ethereum', symbol: 'USDC', name: 'USD Coin', decimals: 6, kind: 'token', locator: { kind: 'evm-contract', value: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/eth', chainId: 'ethereum', symbol: 'ETH', name: 'Ether', decimals: 18, kind: 'native', locator: { kind: 'native', value: 'ETH' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/wbtc', chainId: 'ethereum', symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, kind: 'token', locator: { kind: 'evm-contract', value: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/usdt', chainId: 'ethereum', symbol: 'USDT', name: 'Tether USD', decimals: 6, kind: 'token', locator: { kind: 'evm-contract', value: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }, addressValidationRegex: EVM_ADDRESS },
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
const HYPERLANE_REGISTRY_COMMIT = '2621c16f2db1ccb46643265c110dac5ca2c7c51a'
const HYPERLANE_SOURCE = `https://github.com/hyperlane-xyz/hyperlane-registry/tree/${HYPERLANE_REGISTRY_COMMIT}/deployments/warp_routes`

const ETHEREUM_HYPERLANE_COMMON = {
  sourceChainId: 1,
  destinationDomain: 1634493807,
  mailboxAddress: '0xc005dc82818d67AF737725bD4bf75435d065D239',
  interchainGasPaymaster: '0x9e6B1022bE9BBF5aFd152483DAD9b88911bC8611',
  interchainSecurityModule: '0x0000000000000000000000000000000000000000',
  registryCommit: HYPERLANE_REGISTRY_COMMIT,
} as const

const ETH_HYPERLANE_METADATA = {
  ...ETHEREUM_HYPERLANE_COMMON,
  routerAddress: '0x38D447694f5c1f773ae3132cf93bF30B7Ec1Fa5A',
  routerType: 'native',
  destinationRouter: 'hyp_warp_token_eth_v2.aleo/aleo1t7f29tq9qng2lfvrkpcuvu59jn24hrmzqdyqfn6p0u5p80npfvqqecmkj8',
} as const

const WBTC_HYPERLANE_METADATA = {
  ...ETHEREUM_HYPERLANE_COMMON,
  routerAddress: '0x20CDC85778b732073F7EecEF3DF25c0d310f8772',
  routerType: 'collateral',
  tokenAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  destinationRouter: 'hyp_warp_token_wbtc_v2.aleo/aleo1240fsvz2dhmj0cdtt8mc0yc8um9fmu236rqcl2qnlj9703hd2vpsdwyrtf',
} as const

const USDT_HYPERLANE_METADATA = {
  ...ETHEREUM_HYPERLANE_COMMON,
  routerAddress: '0x3C2064D78e4578E8F936E3db42aEF044E33FBF31',
  routerType: 'collateral',
  tokenAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  destinationRouter: 'hyp_warp_token_usdt_v2.aleo/aleo18yynfz0lrfx0tund540vy2z7gju7ekgqsueg5jgu28mpm2z42ufq7qua8y',
  requiresApprovalReset: true,
} as const

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
  reverseAvailability: 'active' | 'metadata-required' = availability,
): ProtocolBridgeRoute[] {
  return [
    route(`${protocol}:${left}->${right}`, protocol, environment, left, right, availability, deploymentId, metadata),
    route(`${protocol}:${right}->${left}`, protocol, environment, right, left, reverseAvailability, deploymentId, metadata),
  ]
}

const routes: ProtocolBridgeRoute[] = [
  ...pair('xreserve', 'mainnet', 'ethereum/usdc', 'aleo/usdcx', 'active', 'xreserve-usdcx-aleo', {
    xReserveContract: '0x8888888199b2Df864bf678259607d6D5EBb4e3Ce',
    sourceChainId: 1,
    sourceDomain: 0,
    remoteDomain: 10002,
    remoteToken: 'usdcx_stablecoin.aleo',
    remoteTokenBytes32: '0x11ea7dab1d29d5f61500582c63e98c42e1165f9ba050ea9d0c6af9f871987711',
    minimumAmountAtomic: '2000000',
    maxFeeAtomic: '100000',
    bridgeProgram: 'usdcx_bridge_v2.aleo',
    wrapperProgram: 'shielded_usdcx_wrapper.aleo',
    attestationBaseUrl: 'https://xreserve-api.circle.com/v1/attestations',
  }, 'metadata-required'),
  ...pair('xreserve', 'testnet', 'sepolia/usdc', 'aleo-testnet/usdcx', 'active', 'xreserve-usdcx-aleo-testnet', {
    xReserveContract: '0x008888878f94C0d87defdf0B07f46B93C1934442',
    sourceChainId: 11155111,
    sourceDomain: 0,
    remoteDomain: 10002,
    remoteToken: 'test_usdcx_stablecoin.aleo',
    remoteTokenBytes32: '0xb143ed52c774cd1d4a519d0e796f15916be5a9e1d45edcd9852dd23f68f53401',
    minimumAmountAtomic: '2000000',
    maxFeeAtomic: '100000',
    bridgeProgram: 'test_usdcx_bridge_v2.aleo',
    wrapperProgram: 'shielded_usdcx_wrapper.aleo',
    attestationBaseUrl: 'https://xreserve-api-testnet.circle.com/v1/attestations',
  }, 'metadata-required'),
  route('hyperlane:ethereum/eth->aleo/eth', 'hyperlane', 'mainnet', 'ethereum/eth', 'aleo/eth', 'active', 'ETH/aleo', ETH_HYPERLANE_METADATA),
  route('hyperlane:aleo/eth->ethereum/eth', 'hyperlane', 'mainnet', 'aleo/eth', 'ethereum/eth', 'metadata-required', 'ETH/aleo', ETH_HYPERLANE_METADATA),
  route('hyperlane:ethereum/wbtc->aleo/wbtc', 'hyperlane', 'mainnet', 'ethereum/wbtc', 'aleo/wbtc', 'active', 'WBTC/aleo', WBTC_HYPERLANE_METADATA),
  route('hyperlane:aleo/wbtc->ethereum/wbtc', 'hyperlane', 'mainnet', 'aleo/wbtc', 'ethereum/wbtc', 'metadata-required', 'WBTC/aleo', WBTC_HYPERLANE_METADATA),
  route('hyperlane:ethereum/usdt->aleo/usdt', 'hyperlane', 'mainnet', 'ethereum/usdt', 'aleo/usdt', 'active', 'USDT/aleo', USDT_HYPERLANE_METADATA),
  route('hyperlane:aleo/usdt->ethereum/usdt', 'hyperlane', 'mainnet', 'aleo/usdt', 'ethereum/usdt', 'metadata-required', 'USDT/aleo', USDT_HYPERLANE_METADATA),
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
  version: '2026-08-13.xreserve-evm.1',
  chains: Object.freeze(chains),
  assets: Object.freeze(assets),
  routes: Object.freeze(routes),
  sources: Object.freeze([XRESERVE_SOURCE, HYPERLANE_SOURCE]),
})
