import type {
  BridgeEnvironment,
  BridgeProtocol,
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
  { id: 'ethereum', displayName: 'Ethereum', family: 'evm', environment: 'mainnet', nativeCurrencySymbol: 'ETH', protocolDomains: { xreserve: 0, hyperlane: 1, cctp: 0 } },
  { id: 'arc', displayName: 'Arc', family: 'evm', environment: 'mainnet', nativeCurrencySymbol: 'USDC', protocolDomains: { xreserve: 26, cctp: 26 } },
  { id: 'solana', displayName: 'Solana', family: 'solana', environment: 'mainnet', nativeCurrencySymbol: 'SOL', protocolDomains: { hyperlane: 1399811149 } },
  { id: 'base', displayName: 'Base', family: 'evm', environment: 'mainnet', nativeCurrencySymbol: 'ETH', protocolDomains: { cctp: 6 } },
  { id: 'arbitrum', displayName: 'Arbitrum', family: 'evm', environment: 'mainnet', nativeCurrencySymbol: 'ETH', protocolDomains: { cctp: 3 } },
  { id: 'hyperevm', displayName: 'HyperEVM', family: 'evm', environment: 'mainnet', nativeCurrencySymbol: 'HYPE' },
  { id: 'aleo-testnet', displayName: 'Aleo Testnet', family: 'aleo', environment: 'testnet', nativeCurrencySymbol: 'ALEO', protocolDomains: { xreserve: 10002, hyperlane: 1617853565 } },
  { id: 'sepolia', displayName: 'Ethereum Sepolia', family: 'evm', environment: 'testnet', nativeCurrencySymbol: 'ETH', protocolDomains: { xreserve: 0, hyperlane: 11155111 } },
]

const assets: ProtocolBridgeAsset[] = [
  { id: 'aleo/aleo', key: 'aleo', chainId: 'aleo', symbol: 'ALEO', name: 'Aleo', decimals: 6, kind: 'native', locator: { kind: 'aleo-program', value: 'credits.aleo' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/usdcx', key: 'usdcx', chainId: 'aleo', symbol: 'USDCx', name: 'USDCx', decimals: 6, kind: 'token', locator: { kind: 'aleo-program', value: 'usdcx_stablecoin.aleo' }, addressValidationRegex: ALEO_ADDRESS, privacy: { kind: 'arc22', program: 'usdcx_stablecoin.aleo' } },
  { id: 'aleo/eth', key: 'eth', chainId: 'aleo', symbol: 'ETH', name: 'Hyperlane ETH', decimals: 18, kind: 'token', locator: { kind: 'aleo-program', value: 'hyp_warp_token_eth_v2.aleo', tokenId: 'aleo1t7f29tq9qng2lfvrkpcuvu59jn24hrmzqdyqfn6p0u5p80npfvqqecmkj8' }, addressValidationRegex: ALEO_ADDRESS, privacy: { kind: 'arc20', program: 'arc20_eth.aleo' } },
  { id: 'aleo/wbtc', key: 'wbtc', chainId: 'aleo', symbol: 'WBTC', name: 'Hyperlane WBTC', decimals: 8, kind: 'token', locator: { kind: 'aleo-program', value: 'hyp_warp_token_wbtc_v2.aleo', tokenId: 'aleo1240fsvz2dhmj0cdtt8mc0yc8um9fmu236rqcl2qnlj9703hd2vpsdwyrtf' }, addressValidationRegex: ALEO_ADDRESS, privacy: { kind: 'arc20', program: 'arc20_wbtc.aleo' } },
  { id: 'aleo/usdt', key: 'usdt', chainId: 'aleo', symbol: 'USDT', name: 'Hyperlane USDT', decimals: 6, kind: 'token', locator: { kind: 'aleo-program', value: 'hyp_warp_token_usdt_v2.aleo', tokenId: 'aleo18yynfz0lrfx0tund540vy2z7gju7ekgqsueg5jgu28mpm2z42ufq7qua8y' }, addressValidationRegex: ALEO_ADDRESS, privacy: { kind: 'arc20', program: 'arc20_usdt.aleo' } },
  { id: 'aleo/sol', key: 'sol', chainId: 'aleo', symbol: 'SOL', name: 'Hyperlane SOL', decimals: 9, kind: 'token', locator: { kind: 'aleo-program', value: 'hyp_warp_token_sol_v2.aleo', tokenId: 'aleo1aa0zt0vg9uwknekpqeefkvad55swp7833wc5crp2prv0lm4djuxs5r7k6v' }, addressValidationRegex: ALEO_ADDRESS, privacy: { kind: 'arc20', program: 'arc20_sol.aleo' } },
  { id: 'aleo/bat', key: 'bat', chainId: 'aleo', symbol: 'BAT', name: 'Hyperlane BAT', decimals: 18, kind: 'token', locator: { kind: 'aleo-program', value: 'hyp_warp_token_bat_v2.aleo', tokenId: 'aleo1n6kjmle3t0prrwjgpwc87zytasmjdeud5rrwuuawk57ex85qr5fqcv8xzg' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/usdg', key: 'usdg', chainId: 'aleo', symbol: 'USDG', name: 'Hyperlane USDG', decimals: 6, kind: 'token', locator: { kind: 'aleo-program', value: 'hyp_warp_token_usdg_v2.aleo', tokenId: 'aleo1s4r80dv7pcggdnzsavjv45r54zjydl2jn64dejerpk6pgnfj5cysj7zzuu' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/zec', key: 'zec', chainId: 'aleo', symbol: 'ZEC', name: 'Hyperlane ZEC', decimals: 8, kind: 'token', locator: { kind: 'aleo-program', value: 'hyp_warp_token_zec_v2.aleo', tokenId: 'aleo1m3z3en2msfdk62yje9ty7fqydxeakgx0ec6ze672q86p2yxq0sqqyjr9jd' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'aleo/usad', key: 'usad', chainId: 'aleo', symbol: 'USAD', name: 'USAD', decimals: 6, kind: 'token', locator: { kind: 'aleo-program', value: 'usad_stablecoin.aleo' }, addressValidationRegex: ALEO_ADDRESS },
  { id: 'ethereum/usdc', key: 'usdc', chainId: 'ethereum', symbol: 'USDC', name: 'USD Coin', decimals: 6, kind: 'token', locator: { kind: 'evm-contract', value: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'base/usdc', key: 'usdc', chainId: 'base', symbol: 'USDC', name: 'USD Coin', decimals: 6, kind: 'token', locator: { kind: 'evm-contract', value: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'arbitrum/usdc', key: 'usdc', chainId: 'arbitrum', symbol: 'USDC', name: 'USD Coin', decimals: 6, kind: 'token', locator: { kind: 'evm-contract', value: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'arc/usdc', key: 'usdc', chainId: 'arc', symbol: 'USDC', name: 'USD Coin', decimals: 6, kind: 'token', locator: { kind: 'evm-contract', value: '0x3600000000000000000000000000000000000000' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/eth', key: 'eth', chainId: 'ethereum', symbol: 'ETH', name: 'Ether', decimals: 18, kind: 'native', locator: { kind: 'native', value: 'ETH' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/wbtc', key: 'wbtc', chainId: 'ethereum', symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, kind: 'token', locator: { kind: 'evm-contract', value: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/usdt', key: 'usdt', chainId: 'ethereum', symbol: 'USDT', name: 'Tether USD', decimals: 6, kind: 'token', locator: { kind: 'evm-contract', value: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/bat', key: 'bat', chainId: 'ethereum', symbol: 'BAT', name: 'Basic Attention Token', decimals: 18, kind: 'token', locator: { kind: 'evm-contract', value: '0x0D8775F648430679A709E98d2b0Cb6250d2887EF' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/usdg', key: 'usdg', chainId: 'ethereum', symbol: 'USDG', name: 'Global Dollar', decimals: 6, kind: 'token', locator: { kind: 'evm-contract', value: '0xe343167631d89B6Ffc58B88d6b7fB0228795491D' }, addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/aleo', key: 'aleo', chainId: 'ethereum', symbol: 'ALEO', name: 'Hyperlane ALEO', decimals: 6, kind: 'token', addressValidationRegex: EVM_ADDRESS },
  { id: 'ethereum/usad', key: 'usad', chainId: 'ethereum', symbol: 'USAD', name: 'USAD route collateral', decimals: 6, kind: 'token', addressValidationRegex: EVM_ADDRESS },
  { id: 'solana/sol', key: 'sol', chainId: 'solana', symbol: 'SOL', name: 'Solana', decimals: 9, kind: 'native', locator: { kind: 'native', value: 'SOL' }, addressValidationRegex: SOLANA_ADDRESS },
  { id: 'solana/bat', key: 'bat', chainId: 'solana', symbol: 'BAT', name: 'Basic Attention Token', decimals: 8, kind: 'token', locator: { kind: 'solana-mint', value: 'EPeUFDgHRxs9xxEPVaL6kfGQvCon7jmAWKVUHuux1Tpz' }, addressValidationRegex: SOLANA_ADDRESS },
  { id: 'solana/usdg', key: 'usdg', chainId: 'solana', symbol: 'USDG', name: 'Global Dollar', decimals: 6, kind: 'token', locator: { kind: 'solana-mint', value: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH' }, addressValidationRegex: SOLANA_ADDRESS },
  { id: 'solana/zec', key: 'zec', chainId: 'solana', symbol: 'ZEC', name: 'Zcash', decimals: 8, kind: 'token', locator: { kind: 'solana-mint', value: 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS' }, addressValidationRegex: SOLANA_ADDRESS },
  { id: 'solana/aleo', key: 'aleo', chainId: 'solana', symbol: 'ALEO', name: 'Hyperlane ALEO', decimals: 6, kind: 'token', addressValidationRegex: SOLANA_ADDRESS },
  { id: 'base/aleo', key: 'aleo', chainId: 'base', symbol: 'ALEO', name: 'Hyperlane ALEO', decimals: 6, kind: 'token', addressValidationRegex: EVM_ADDRESS },
  { id: 'hyperevm/aleo', key: 'aleo', chainId: 'hyperevm', symbol: 'ALEO', name: 'Hyperlane ALEO', decimals: 6, kind: 'token', addressValidationRegex: EVM_ADDRESS },
  { id: 'aleo-testnet/usdcx', key: 'usdcx', chainId: 'aleo-testnet', symbol: 'USDCx', name: 'Testnet USDCx', decimals: 6, kind: 'token', locator: { kind: 'aleo-program', value: 'test_usdcx_stablecoin.aleo' }, addressValidationRegex: ALEO_ADDRESS, privacy: { kind: 'arc22', program: 'test_usdcx_stablecoin.aleo' } },
  { id: 'sepolia/usdc', key: 'usdc', chainId: 'sepolia', symbol: 'USDC', name: 'Testnet USD Coin', decimals: 6, kind: 'token', locator: { kind: 'evm-contract', value: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' }, addressValidationRegex: EVM_ADDRESS },
]

const CCTP_SOURCE = 'https://developers.circle.com/cctp/references/contract-addresses'
const USDC_SOURCE = 'https://developers.circle.com/stablecoins/usdc-contract-addresses'
// Pins the Circle CCTP V2 mainnet deployment table and remote messengers reviewed on 2026-09-29.
const CCTP_MAINNET_METADATA = {
  tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
  messageTransmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
  attestationBaseUrl: 'https://iris-api.circle.com',
  deploymentReviewedAt: '2026-09-29',
  tokenSource: USDC_SOURCE,
} as const

const XRESERVE_SOURCE = 'https://developers.circle.com/xreserve/references/supported-blockchains-and-domains'
const ALEO_XRESERVE_SOURCE = 'https://docs.aleo.org/build/common-uses/usdcx_bridge'
const HYPERLANE_REGISTRY_COMMIT = '2621c16f2db1ccb46643265c110dac5ca2c7c51a'
const HYPERLANE_SOURCE = `https://github.com/hyperlane-xyz/hyperlane-registry/tree/${HYPERLANE_REGISTRY_COMMIT}/deployments/warp_routes`
const NEW_WARP_ROUTES_REGISTRY_COMMIT = 'dd03567baf2a7c0a336c12a1e2b97272ca51ee9a'
const BAT_HYPERLANE_CONFIG_SOURCE = `https://github.com/hyperlane-xyz/hyperlane-registry/blob/${NEW_WARP_ROUTES_REGISTRY_COMMIT}/deployments/warp_routes/BAT/aleo-config.yaml`
const USDG_HYPERLANE_CONFIG_SOURCE = `https://github.com/hyperlane-xyz/hyperlane-registry/blob/${NEW_WARP_ROUTES_REGISTRY_COMMIT}/deployments/warp_routes/USDG/aleo-config.yaml`
const ZEC_HYPERLANE_CONFIG_SOURCE = `https://github.com/hyperlane-xyz/hyperlane-registry/blob/${NEW_WARP_ROUTES_REGISTRY_COMMIT}/deployments/warp_routes/ZEC/aleo-config.yaml`
const ALEO_ETH_PROGRAM_SOURCE = 'https://explorer.provable.com/program/hyp_warp_token_eth_v2.aleo'
const ALEO_ETH_APP_METADATA_SOURCE = 'https://api.explorer.provable.com/v2/mainnet/program/hyp_warp_token_eth_v2.aleo/mapping/app_metadata/true'
const ALEO_ETH_REMOTE_ROUTER_SOURCE = 'https://api.explorer.provable.com/v2/mainnet/program/hyp_warp_token_eth_v2.aleo/mapping/remote_routers/1u32'
const ALEO_ETH_SAMPLE_TRANSFER_SOURCE = 'https://explorer.provable.com/transaction/at1vu0yckkms887zkl3qz7plnncd56jtf5zeal4uj2808upsjkusy8q7yp9v8'
const ALEO_WBTC_PROGRAM_SOURCE = 'https://explorer.provable.com/program/hyp_warp_token_wbtc_v2.aleo'
const ALEO_WBTC_APP_METADATA_SOURCE = 'https://api.explorer.provable.com/v2/mainnet/program/hyp_warp_token_wbtc_v2.aleo/mapping/app_metadata/true'
const ALEO_WBTC_REMOTE_ROUTER_SOURCE = 'https://api.explorer.provable.com/v2/mainnet/program/hyp_warp_token_wbtc_v2.aleo/mapping/remote_routers/1u32'
const ALEO_USDT_PROGRAM_SOURCE = 'https://explorer.provable.com/program/hyp_warp_token_usdt_v2.aleo'
const ALEO_USDT_APP_METADATA_SOURCE = 'https://api.explorer.provable.com/v2/mainnet/program/hyp_warp_token_usdt_v2.aleo/mapping/app_metadata/true'
const ALEO_USDT_ETHEREUM_REMOTE_ROUTER_SOURCE = 'https://api.explorer.provable.com/v2/mainnet/program/hyp_warp_token_usdt_v2.aleo/mapping/remote_routers/1u32'
const ALEO_USDT_SAMPLE_TRANSFER_SOURCE = 'https://explorer.provable.com/transaction/at19caeeee8v3xc4kfwen4tx89f0tnggrpjp0anrhq2ca3y82xr9q8qyz8a9r'
const ALEO_USDT_HYPERLANE_CONFIG_SOURCE = 'https://github.com/hyperlane-xyz/hyperlane-registry/blob/418056e21734d26a7d14692e0ec5e902cc9e86bf/deployments/warp_routes/USDT/aleo-config.yaml'
const ALEO_SOL_PROGRAM_SOURCE = 'https://explorer.provable.com/program/hyp_warp_token_sol_v2.aleo'
const ALEO_SOL_APP_METADATA_SOURCE = 'https://api.explorer.provable.com/v2/mainnet/program/hyp_warp_token_sol_v2.aleo/mapping/app_metadata/true'
const ALEO_SOL_REMOTE_ROUTER_SOURCE = 'https://api.explorer.provable.com/v2/mainnet/program/hyp_warp_token_sol_v2.aleo/mapping/remote_routers/1399811149u32'
const ALEO_SOL_HYPERLANE_CONFIG_SOURCE = 'https://github.com/hyperlane-xyz/hyperlane-registry/blob/418056e21734d26a7d14692e0ec5e902cc9e86bf/deployments/warp_routes/SOL/aleo-config.yaml'
const ALEO_MAILBOX_PROGRAM_SOURCE = 'https://explorer.provable.com/program/hyp_mailbox.aleo'
const ALEO_MAILBOX_METADATA_SOURCE = 'https://api.explorer.provable.com/v2/mainnet/program/hyp_mailbox.aleo/mapping/mailbox/true'

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

function evmCollateralHyperlaneMetadata(
  routerAddress: string,
  tokenAddress: string,
  destinationRouter: string,
  hyperlaneConfigSource: string,
) {
  return {
    ...ETHEREUM_HYPERLANE_COMMON,
    routerAddress,
    routerType: 'collateral',
    tokenAddress,
    destinationRouter,
    registryCommit: NEW_WARP_ROUTES_REGISTRY_COMMIT,
    hyperlaneConfigSource,
  } as const
}

const BAT_HYPERLANE_METADATA = evmCollateralHyperlaneMetadata(
  '0x516e156e987175d74614cc2bC960f148A610f0b3',
  '0x0D8775F648430679A709E98d2b0Cb6250d2887EF',
  'hyp_warp_token_bat_v2.aleo/aleo1n6kjmle3t0prrwjgpwc87zytasmjdeud5rrwuuawk57ex85qr5fqcv8xzg',
  BAT_HYPERLANE_CONFIG_SOURCE,
)

const USDG_HYPERLANE_METADATA = evmCollateralHyperlaneMetadata(
  '0xe5A2cCf532919f93855F324c1F8a7996065f53Da',
  '0xe343167631d89B6Ffc58B88d6b7fB0228795491D',
  'hyp_warp_token_usdg_v2.aleo/aleo1s4r80dv7pcggdnzsavjv45r54zjydl2jn64dejerpk6pgnfj5cysj7zzuu',
  USDG_HYPERLANE_CONFIG_SOURCE,
)

function solanaCollateralDiscoveryMetadata(
  warpProgramAddress: string,
  collateralMint: string,
  destinationRouter: string,
  hyperlaneConfigSource: string,
) {
  return {
    ...ALEO_MAILBOX_METADATA,
    warpProgramAddress,
    collateralMint,
    destinationRouter,
    destinationDomain: 1634493807,
    destinationGasAmount: '300000',
    registryCommit: NEW_WARP_ROUTES_REGISTRY_COMMIT,
    hyperlaneConfigSource,
  } as const
}

// Intentionally non-live values used only to expose the Aleo transfer_remote ABI.
// execute refuses these routes while the flag is true.
const ALEO_PLACEHOLDER_ADDRESS = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const ALEO_PLACEHOLDER_BYTES32 = `[${Array.from({ length: 32 }, () => '0u8').join(', ')}]`

const ALEO_MAILBOX_METADATA = {
  aleoMailboxStateVerified: true,
  aleoHookManagerProgram: 'hyp_hook_manager.aleo',
  aleoHookManagerProgramSource: 'https://explorer.provable.com/program/hyp_hook_manager.aleo',
  aleoMailboxProgram: 'hyp_mailbox.aleo',
  aleoMailboxProgramEdition: 0,
  aleoMailboxProgramSource: ALEO_MAILBOX_PROGRAM_SOURCE,
  aleoMailboxMetadataSource: ALEO_MAILBOX_METADATA_SOURCE,
  aleoMailboxMetadataReviewedAt: '2026-08-17',
  aleoMailboxLocalDomain: 1634493807,
  aleoMailboxObservedNonce: 170,
  aleoMailboxObservedProcessCount: 291,
  aleoMailboxDefaultIsm: 'aleo1yvf5kcsdgnescqq2lar83mms79yh3ugvc3y0mdnlgvx4lyh5zugqr9hptk',
  aleoMailboxDefaultHook: 'aleo194tz0jmyq8rd9htvnqppqw4jqerk2p2zd8plzn3sxl06wcgsm5pq9fka74',
  aleoMailboxRequiredHook: 'aleo1yxevh9qgxehej46j7vueplwjcpfdfml2dje3ey4ukzknx7wzasgqnxgq82',
  aleoMailboxDispatchProxy: 'aleo1sge9kmjzs3d8fqrscy4hwn7vf9vw4jcxe877lv0m2w8hay78lsxsqg975s',
  aleoMailboxOwner: 'aleo1ypf8xgvz560ukw25hufj3d77gx69pdcy70nssdfdxd97j80d7cqs98d7x8',
} as const

function aleoHyperlanePlaceholders(program: string, destinationDomain: number) {
  return {
    aleoRouterProgram: program,
    aleoDestinationDomain: destinationDomain,
    aleoPlaceholderConfiguration: true,
    aleoTokenType: '0',
    aleoTokenOwner: ALEO_PLACEHOLDER_ADDRESS,
    aleoIsm: ALEO_PLACEHOLDER_ADDRESS,
    aleoHook: ALEO_PLACEHOLDER_ADDRESS,
    aleoTokenId: '0field',
    aleoRemoteRouterRecipient: ALEO_PLACEHOLDER_BYTES32,
    aleoRemoteRouterGas: '0',
    aleoRecipient: '[0u128, 0u128]',
    aleoAllowanceSpender0: ALEO_PLACEHOLDER_ADDRESS,
    aleoAllowanceAmount0: '0',
    aleoAllowanceSpender1: ALEO_PLACEHOLDER_ADDRESS,
    aleoAllowanceAmount1: '0',
    aleoAllowanceSpender2: ALEO_PLACEHOLDER_ADDRESS,
    aleoAllowanceAmount2: '0',
    aleoAllowanceSpender3: ALEO_PLACEHOLDER_ADDRESS,
    aleoAllowanceAmount3: '0',
    ...ALEO_MAILBOX_METADATA,
  } as const
}

const ALEO_WBTC_APP_METADATA = {
  aleoAppMetadataVerified: true,
  aleoProgramSource: ALEO_WBTC_PROGRAM_SOURCE,
  aleoAppMetadataSource: ALEO_WBTC_APP_METADATA_SOURCE,
  aleoAppMetadataReviewedAt: '2026-08-17',
  aleoProgramEdition: 0,
  aleoTokenType: '1',
  aleoTokenOwner: 'aleo14jauje2a5sncm9u5t3mt6qqv3eq2hatkddskccs0dvsy35a0x58q0d6f95',
  aleoIsm: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoHook: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoTokenId: '1505227928464760254508513036497943623956572091841806589002910775534260084309field',
  aleoLocalDecimals: 8,
  aleoRemoteDecimals: 8,
} as const

const ALEO_ETH_APP_METADATA = {
  aleoAppMetadataVerified: true,
  aleoProgramSource: ALEO_ETH_PROGRAM_SOURCE,
  aleoAppMetadataSource: ALEO_ETH_APP_METADATA_SOURCE,
  aleoAppMetadataReviewedAt: '2026-08-17',
  aleoProgramEdition: 0,
  aleoTokenType: '1',
  aleoTokenOwner: 'aleo1wq6f6qdqya44avznygz5hae40u3mjg64w0r93a4qfu4utpf8cg9q566f4r',
  aleoIsm: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoHook: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoTokenId: '133188123661477349522757068766864658505569365361420630212878794317749195359field',
  aleoLocalDecimals: 18,
  aleoRemoteDecimals: 18,
} as const

const ALEO_USDT_APP_METADATA = {
  aleoAppMetadataVerified: true,
  aleoProgramSource: ALEO_USDT_PROGRAM_SOURCE,
  aleoAppMetadataSource: ALEO_USDT_APP_METADATA_SOURCE,
  aleoAppMetadataReviewedAt: '2026-08-17',
  aleoProgramEdition: 1,
  aleoTokenType: '1',
  aleoTokenOwner: 'aleo1l3gwacmjruxryy9c7c4fn0acyzprf29hucrvthw7f63lpyhd5y9srydq8z',
  aleoIsm: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoHook: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoTokenId: '8295938150000417034830036849466229528602563851235385582732969109393809606969field',
  aleoLocalDecimals: 6,
  aleoRemoteDecimals: 18,
  aleoScale: '1000000000000',
  aleoHyperlaneConfigSource: ALEO_USDT_HYPERLANE_CONFIG_SOURCE,
} as const

const ALEO_SOL_APP_METADATA = {
  aleoAppMetadataVerified: true,
  aleoProgramSource: ALEO_SOL_PROGRAM_SOURCE,
  aleoAppMetadataSource: ALEO_SOL_APP_METADATA_SOURCE,
  aleoAppMetadataReviewedAt: '2026-08-17',
  aleoProgramEdition: 0,
  aleoTokenType: '1',
  aleoTokenOwner: 'aleo1wr8rfr4ggedjxtg5e23s38zqkgy2j05uc9l8t4akjp5zcw3levpswkwk45',
  aleoIsm: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoHook: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoTokenId: '6148061383892805373029428966764338809222769879628268522058032128225601478383field',
  aleoLocalDecimals: 9,
  aleoRemoteDecimals: 9,
  aleoHyperlaneConfigSource: ALEO_SOL_HYPERLANE_CONFIG_SOURCE,
} as const

const ALEO_ETH_REMOTE_ROUTER = {
  aleoRemoteRouterVerified: true,
  aleoRemoteRouterSource: ALEO_ETH_REMOTE_ROUTER_SOURCE,
  aleoRemoteRouterReviewedAt: '2026-08-17',
  aleoSampleTransferSource: ALEO_ETH_SAMPLE_TRANSFER_SOURCE,
  aleoDestinationDomain: 1,
  aleoRemoteRouterEvmAddress: '0x38D447694f5c1f773ae3132cf93bF30B7Ec1Fa5A',
  aleoRemoteRouterRecipient: '[0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 56u8, 212u8, 71u8, 105u8, 79u8, 92u8, 31u8, 119u8, 58u8, 227u8, 19u8, 44u8, 249u8, 59u8, 243u8, 11u8, 126u8, 193u8, 250u8, 90u8]',
  aleoRemoteRouterGas: '44000',
  aleoAllowanceSpendersVerified: true,
  aleoUnusedAllowancesVerified: true,
  aleoAllowanceSpender0: 'aleo194tz0jmyq8rd9htvnqppqw4jqerk2p2zd8plzn3sxl06wcgsm5pq9fka74',
  aleoAllowanceSpender1: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoAllowanceSpender2: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoAllowanceSpender3: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoAllowanceAmount1: '0',
  aleoAllowanceAmount2: '0',
  aleoAllowanceAmount3: '0',
} as const

const ALEO_WBTC_REMOTE_ROUTER = {
  aleoRemoteRouterVerified: true,
  aleoRemoteRouterSource: ALEO_WBTC_REMOTE_ROUTER_SOURCE,
  aleoRemoteRouterReviewedAt: '2026-08-17',
  aleoDestinationDomain: 1,
  aleoRemoteRouterEvmAddress: '0x20CDC85778b732073F7EecEF3DF25c0d310f8772',
  aleoRemoteRouterRecipient: '[0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 32u8, 205u8, 200u8, 87u8, 120u8, 183u8, 50u8, 7u8, 63u8, 126u8, 236u8, 239u8, 61u8, 242u8, 92u8, 13u8, 49u8, 15u8, 135u8, 114u8]',
  aleoRemoteRouterGas: '68000',
  aleoAllowanceSpendersVerified: true,
  aleoUnusedAllowancesVerified: true,
  aleoAllowanceSpender0: 'aleo194tz0jmyq8rd9htvnqppqw4jqerk2p2zd8plzn3sxl06wcgsm5pq9fka74',
  aleoAllowanceSpender1: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoAllowanceSpender2: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoAllowanceSpender3: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoAllowanceAmount1: '0',
  aleoAllowanceAmount2: '0',
  aleoAllowanceAmount3: '0',
} as const

const ALEO_USDT_ETHEREUM_REMOTE_ROUTER = {
  aleoRemoteRouterVerified: true,
  aleoRemoteRouterSource: ALEO_USDT_ETHEREUM_REMOTE_ROUTER_SOURCE,
  aleoRemoteRouterReviewedAt: '2026-08-17',
  aleoSampleTransferSource: ALEO_USDT_SAMPLE_TRANSFER_SOURCE,
  aleoSampleTransferDestinationDomain: 56,
  aleoDestinationDomain: 1,
  aleoRemoteRouterEvmAddress: '0x3C2064D78e4578E8F936E3db42aEF044E33FBF31',
  aleoRemoteRouterRecipient: '[0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 60u8, 32u8, 100u8, 215u8, 142u8, 69u8, 120u8, 232u8, 249u8, 54u8, 227u8, 219u8, 66u8, 174u8, 240u8, 68u8, 227u8, 63u8, 191u8, 49u8]',
  aleoRemoteRouterGas: '68000',
  aleoAllowanceSpendersVerified: true,
  aleoUnusedAllowancesVerified: true,
  aleoAllowanceSpender0: 'aleo194tz0jmyq8rd9htvnqppqw4jqerk2p2zd8plzn3sxl06wcgsm5pq9fka74',
  aleoAllowanceSpender1: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoAllowanceSpender2: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoAllowanceSpender3: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoAllowanceAmount1: '0',
  aleoAllowanceAmount2: '0',
  aleoAllowanceAmount3: '0',
} as const

const ALEO_SOL_REMOTE_ROUTER = {
  aleoRemoteRouterVerified: true,
  aleoRemoteRouterSource: ALEO_SOL_REMOTE_ROUTER_SOURCE,
  aleoRemoteRouterReviewedAt: '2026-08-17',
  aleoSampleTransitionId: 'au15fg39h53h55tkj0nexrme3k6pvgxngxapcyajdhf06jcg3cyeugq5kd7hg',
  aleoDestinationDomain: 1399811149,
  aleoRemoteRouterSolanaAddress: '8YGT2pZwyZe94qBpGzWfY2TMEVcwaQ1bXAE7YAgpUaM7',
  aleoRemoteRouterRecipient: '[112u8, 4u8, 72u8, 22u8, 219u8, 143u8, 68u8, 202u8, 21u8, 197u8, 236u8, 182u8, 198u8, 142u8, 52u8, 96u8, 142u8, 38u8, 51u8, 113u8, 116u8, 143u8, 96u8, 123u8, 104u8, 126u8, 97u8, 73u8, 7u8, 6u8, 211u8, 122u8]',
  aleoRemoteRouterGas: '300000',
  aleoAllowanceSpendersVerified: true,
  aleoUnusedAllowancesVerified: true,
  aleoAllowanceSpender0: 'aleo194tz0jmyq8rd9htvnqppqw4jqerk2p2zd8plzn3sxl06wcgsm5pq9fka74',
  aleoAllowanceSpender1: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoAllowanceSpender2: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoAllowanceSpender3: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
  aleoAllowanceAmount1: '0',
  aleoAllowanceAmount2: '0',
  aleoAllowanceAmount3: '0',
} as const

const ALEO_WITHDRAWAL_ACTIVATION = {
  aleoPlaceholderConfiguration: false,
  aleoWithdrawalReviewedAt: '2026-08-26',
} as const

// Reviewed Sealevel deployment for the Solana-origin SOL deposit route
// (`hyperlane:solana/sol->aleo/sol`). Cross-verified against two independent
// sources per account, per packages/bridge/src/solana/SEALEVEL_NOTES.md §2:
// the hyperlane-registry snapshot at commit 418056e21734d26a7d14692e0ec5e902cc9e86bf
// (mailbox and terminal IGP account, from chains/solanamainnet/addresses.yaml;
// warp program id, from deployments/warp_routes/SOL/aleo-config.yaml,
// ALEO_SOL_HYPERLANE_CONFIG_SOURCE above) confirms the accounts it carries,
// and the real mainnet deposit captured in
// test/fixtures/sealevel-transfer-remote.json (plus
// test/fixtures/sealevel-igp-account.json for the IGP account) confirms
// every account, including the program-derived addresses the registry does
// not itself carry. No discrepancy was found between the two sources for
// any account.
const SOLANA_SOL_DEPOSIT_METADATA = {
  warpProgramAddress: '8YGT2pZwyZe94qBpGzWfY2TMEVcwaQ1bXAE7YAgpUaM7',
  tokenPda: 'JDkpV5CsSbhyGhHhirC5DjGPTcuKWUVHtBZ5MFsgu3ZW',
  nativeCollateralPda: '8HY3hxmnrWwqEmcdwkSnfN9wEQFUkyiwZvU1vMbnXgbC',
  dispatchAuthorityPda: 'ATDttjggAZKyS19kcV6Rn56oMi49gDprZGckRou9vkkY',
  mailboxProgramAddress: 'E588QtVUvresuXq2KoNEwAmoifCzYGpRBdHByN9KQMbi',
  mailboxOutboxPda: 'BvZpTuYLAR77mPhH4GtvwEWUTs53GQqkgBNuXpCePVNk',
  igpProgramAddress: 'BhNcatUDC2D5JTyeaqrdSukiVFsEHK7e3hVmKMztwefv',
  igpProgramDataPda: '8Cv4PHJ6Cf3xY7dse7wYeZKtuQv9SAN6ujt5w22a2uho',
  igpAccount: 'JAvHW21tYXE9dtdG83DReqU2b4LUexFuCbtJT5tF8X6M',
  igpOverheadAccount: 'AkeHBbE5JkwVppujCQQ6WuxsVsJtruBAjUo6fDCFp6fF',
  splNoopProgramAddress: 'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV',
  destinationDomain: 1634493807,
  destinationGasAmount: '464000',
  registryCommit: '418056e21734d26a7d14692e0ec5e902cc9e86bf',
  solanaReviewedAt: '2026-08-31',
  solanaConfigSource: ALEO_SOL_HYPERLANE_CONFIG_SOURCE,
} as const

function route(
  id: string,
  protocol: BridgeProtocol,
  environment: BridgeEnvironment,
  sourceAssetId: string,
  destinationAssetId: string,
  availability: 'active' | 'metadata-required',
  deploymentId: string,
  metadata?: Readonly<Record<string, string | number | boolean>>,
  source?: string,
): ProtocolBridgeRoute {
  return {
    id,
    protocol,
    environment,
    sourceAssetId,
    destinationAssetId,
    availability,
    deploymentId,
    source: source ?? (protocol === 'xreserve' ? XRESERVE_SOURCE : protocol === 'cctp' ? CCTP_SOURCE : HYPERLANE_SOURCE),
    ...(metadata == null ? {} : { metadata }),
  }
}

function pair(
  protocol: BridgeProtocol,
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
    ethereumDestinationDomain: 0,
    arcDestinationDomain: 26,
    remoteDomain: 10002,
    remoteToken: 'usdcx_stablecoin.aleo',
    remoteTokenBytes32: '0x11ea7dab1d29d5f61500582c63e98c42e1165f9ba050ea9d0c6af9f871987711',
    minimumAmountAtomic: '2000000',
    withdrawalFeeAtomic: '2000000',
    maxFeeAtomic: '100000',
    bridgeProgram: 'usdcx_bridge_v2.aleo',
    wrapperProgram: 'shielded_usdcx_wrapper.aleo',
    attestationBaseUrl: 'https://xreserve-api.circle.com/v1/attestations',
  }, 'active'),
  ...pair('xreserve', 'mainnet', 'arc/usdc', 'aleo/usdcx', 'active', 'xreserve-usdcx-aleo-arc', {
    xReserveContract: '0x8888888199b2Df864bf678259607d6D5EBb4e3Ce',
    sourceChainId: 5042,
    sourceDomain: 26,
    minimumBurnAmountAtomic: '2000000',
    withdrawalFeeAtomic: '16400',
    withdrawalFeeUrl: 'https://api.usdcx.aleo.org/api/estimate-burn-fee',
    withdrawalFeeChain: 'arc',
    withdrawalFeeSource: 'https://usdcx.aleo.org/assets/index-C4YEghH3.js',
    ethereumDestinationDomain: 0,
    arcDestinationDomain: 26,
    remoteDomain: 10002,
    remoteToken: 'usdcx_stablecoin.aleo',
    remoteTokenBytes32: '0x11ea7dab1d29d5f61500582c63e98c42e1165f9ba050ea9d0c6af9f871987711',
    minimumAmountAtomic: '2000000',
    maxFeeAtomic: '100000',
    bridgeProgram: 'usdcx_bridge_v2.aleo',
    wrapperProgram: 'shielded_usdcx_wrapper.aleo',
    attestationBaseUrl: 'https://xreserve-api.circle.com/v1/attestations',
    deploymentSource: ALEO_XRESERVE_SOURCE,
    onchainReviewedAt: '2026-09-28',
  }),
  route('cctp:ethereum/usdc->arc/usdc', 'cctp', 'mainnet', 'ethereum/usdc', 'arc/usdc', 'active', 'cctp-v2-ethereum-arc', { ...CCTP_MAINNET_METADATA, destinationChainId: 5042, destinationDomain: 26, sourceChainId: 1, sourceDomain: 0 }),
  route('cctp:base/usdc->arc/usdc', 'cctp', 'mainnet', 'base/usdc', 'arc/usdc', 'active', 'cctp-v2-base-arc', { ...CCTP_MAINNET_METADATA, destinationChainId: 5042, destinationDomain: 26, sourceChainId: 8453, sourceDomain: 6 }),
  route('cctp:arbitrum/usdc->arc/usdc', 'cctp', 'mainnet', 'arbitrum/usdc', 'arc/usdc', 'active', 'cctp-v2-arbitrum-arc', { ...CCTP_MAINNET_METADATA, destinationChainId: 5042, destinationDomain: 26, sourceChainId: 42161, sourceDomain: 3 }),
  route('cctp:arc/usdc->ethereum/usdc', 'cctp', 'mainnet', 'arc/usdc', 'ethereum/usdc', 'active', 'cctp-v2-arc-ethereum', { ...CCTP_MAINNET_METADATA, sourceChainId: 5042, sourceDomain: 26, destinationChainId: 1, destinationDomain: 0 }),
  route('cctp:arc/usdc->base/usdc', 'cctp', 'mainnet', 'arc/usdc', 'base/usdc', 'active', 'cctp-v2-arc-base', { ...CCTP_MAINNET_METADATA, sourceChainId: 5042, sourceDomain: 26, destinationChainId: 8453, destinationDomain: 6 }),
  route('cctp:arc/usdc->arbitrum/usdc', 'cctp', 'mainnet', 'arc/usdc', 'arbitrum/usdc', 'active', 'cctp-v2-arc-arbitrum', { ...CCTP_MAINNET_METADATA, sourceChainId: 5042, sourceDomain: 26, destinationChainId: 42161, destinationDomain: 3 }),
  ...pair('xreserve', 'testnet', 'sepolia/usdc', 'aleo-testnet/usdcx', 'active', 'xreserve-usdcx-aleo-testnet', {
    xReserveContract: '0x008888878f94C0d87defdf0B07f46B93C1934442',
    sourceChainId: 11155111,
    sourceDomain: 0,
    ethereumDestinationDomain: 0,
    arcDestinationDomain: 26,
    remoteDomain: 10002,
    remoteToken: 'test_usdcx_stablecoin.aleo',
    remoteTokenBytes32: '0xb143ed52c774cd1d4a519d0e796f15916be5a9e1d45edcd9852dd23f68f53401',
    minimumAmountAtomic: '2000000',
    withdrawalFeeAtomic: '2000000',
    maxFeeAtomic: '100000',
    bridgeProgram: 'test_usdcx_bridge_v2.aleo',
    wrapperProgram: 'shielded_usdcx_wrapper.aleo',
    attestationBaseUrl: 'https://xreserve-api-testnet.circle.com/v1/attestations',
  }, 'active'),
  route('hyperlane:ethereum/eth->aleo/eth', 'hyperlane', 'mainnet', 'ethereum/eth', 'aleo/eth', 'active', 'ETH/aleo', { ...ETH_HYPERLANE_METADATA, ...ALEO_MAILBOX_METADATA }),
  route('hyperlane:aleo/eth->ethereum/eth', 'hyperlane', 'mainnet', 'aleo/eth', 'ethereum/eth', 'active', 'ETH/aleo', { ...ETH_HYPERLANE_METADATA, ...aleoHyperlanePlaceholders('hyp_warp_token_eth_v2.aleo', 1), ...ALEO_ETH_APP_METADATA, ...ALEO_ETH_REMOTE_ROUTER, ...ALEO_WITHDRAWAL_ACTIVATION }),
  route('hyperlane:ethereum/wbtc->aleo/wbtc', 'hyperlane', 'mainnet', 'ethereum/wbtc', 'aleo/wbtc', 'active', 'WBTC/aleo', { ...WBTC_HYPERLANE_METADATA, ...ALEO_MAILBOX_METADATA }),
  route('hyperlane:aleo/wbtc->ethereum/wbtc', 'hyperlane', 'mainnet', 'aleo/wbtc', 'ethereum/wbtc', 'active', 'WBTC/aleo', { ...WBTC_HYPERLANE_METADATA, ...aleoHyperlanePlaceholders('hyp_warp_token_wbtc_v2.aleo', 1), ...ALEO_WBTC_APP_METADATA, ...ALEO_WBTC_REMOTE_ROUTER, ...ALEO_WITHDRAWAL_ACTIVATION }),
  route('hyperlane:ethereum/usdt->aleo/usdt', 'hyperlane', 'mainnet', 'ethereum/usdt', 'aleo/usdt', 'active', 'USDT/aleo', { ...USDT_HYPERLANE_METADATA, ...ALEO_MAILBOX_METADATA }),
  route('hyperlane:aleo/usdt->ethereum/usdt', 'hyperlane', 'mainnet', 'aleo/usdt', 'ethereum/usdt', 'active', 'USDT/aleo', { ...USDT_HYPERLANE_METADATA, ...aleoHyperlanePlaceholders('hyp_warp_token_usdt_v2.aleo', 1), ...ALEO_USDT_APP_METADATA, ...ALEO_USDT_ETHEREUM_REMOTE_ROUTER, ...ALEO_WITHDRAWAL_ACTIVATION }),
  route('hyperlane:ethereum/bat->aleo/bat', 'hyperlane', 'mainnet', 'ethereum/bat', 'aleo/bat', 'active', 'BAT/aleo', { ...BAT_HYPERLANE_METADATA, ...ALEO_MAILBOX_METADATA }, BAT_HYPERLANE_CONFIG_SOURCE),
  route('hyperlane:aleo/bat->ethereum/bat', 'hyperlane', 'mainnet', 'aleo/bat', 'ethereum/bat', 'metadata-required', 'BAT/aleo', { ...BAT_HYPERLANE_METADATA, ...aleoHyperlanePlaceholders('hyp_warp_token_bat_v2.aleo', 1), hyperlaneConfigSource: BAT_HYPERLANE_CONFIG_SOURCE }, BAT_HYPERLANE_CONFIG_SOURCE),
  route('hyperlane:ethereum/usdg->aleo/usdg', 'hyperlane', 'mainnet', 'ethereum/usdg', 'aleo/usdg', 'active', 'USDG/aleo', { ...USDG_HYPERLANE_METADATA, ...ALEO_MAILBOX_METADATA }, USDG_HYPERLANE_CONFIG_SOURCE),
  route('hyperlane:aleo/usdg->ethereum/usdg', 'hyperlane', 'mainnet', 'aleo/usdg', 'ethereum/usdg', 'metadata-required', 'USDG/aleo', { ...USDG_HYPERLANE_METADATA, ...aleoHyperlanePlaceholders('hyp_warp_token_usdg_v2.aleo', 1), hyperlaneConfigSource: USDG_HYPERLANE_CONFIG_SOURCE }, USDG_HYPERLANE_CONFIG_SOURCE),
  route('hyperlane:solana/sol->aleo/sol', 'hyperlane', 'mainnet', 'solana/sol', 'aleo/sol', 'active', 'SOL/aleo', { ...SOLANA_SOL_DEPOSIT_METADATA, ...ALEO_MAILBOX_METADATA }),
  route('hyperlane:aleo/sol->solana/sol', 'hyperlane', 'mainnet', 'aleo/sol', 'solana/sol', 'active', 'SOL/aleo', { ...aleoHyperlanePlaceholders('hyp_warp_token_sol_v2.aleo', 1399811149), ...ALEO_SOL_APP_METADATA, ...ALEO_SOL_REMOTE_ROUTER, ...ALEO_WITHDRAWAL_ACTIVATION }),
  route('hyperlane:solana/bat->aleo/bat', 'hyperlane', 'mainnet', 'solana/bat', 'aleo/bat', 'metadata-required', 'BAT/aleo', solanaCollateralDiscoveryMetadata('7CJFBsNC49upnVfMga2gj53deAjuuVchdceJQrJg5oA5', 'EPeUFDgHRxs9xxEPVaL6kfGQvCon7jmAWKVUHuux1Tpz', 'hyp_warp_token_bat_v2.aleo/aleo1n6kjmle3t0prrwjgpwc87zytasmjdeud5rrwuuawk57ex85qr5fqcv8xzg', BAT_HYPERLANE_CONFIG_SOURCE), BAT_HYPERLANE_CONFIG_SOURCE),
  route('hyperlane:aleo/bat->solana/bat', 'hyperlane', 'mainnet', 'aleo/bat', 'solana/bat', 'metadata-required', 'BAT/aleo', { ...aleoHyperlanePlaceholders('hyp_warp_token_bat_v2.aleo', 1399811149), aleoRemoteRouterSolanaAddress: '7CJFBsNC49upnVfMga2gj53deAjuuVchdceJQrJg5oA5', hyperlaneConfigSource: BAT_HYPERLANE_CONFIG_SOURCE }, BAT_HYPERLANE_CONFIG_SOURCE),
  route('hyperlane:solana/usdg->aleo/usdg', 'hyperlane', 'mainnet', 'solana/usdg', 'aleo/usdg', 'metadata-required', 'USDG/aleo', solanaCollateralDiscoveryMetadata('AhNVa6VpZwDwgD3U66CGUwCMRcFSFiTfBse2D495SPxW', '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH', 'hyp_warp_token_usdg_v2.aleo/aleo1s4r80dv7pcggdnzsavjv45r54zjydl2jn64dejerpk6pgnfj5cysj7zzuu', USDG_HYPERLANE_CONFIG_SOURCE), USDG_HYPERLANE_CONFIG_SOURCE),
  route('hyperlane:aleo/usdg->solana/usdg', 'hyperlane', 'mainnet', 'aleo/usdg', 'solana/usdg', 'metadata-required', 'USDG/aleo', { ...aleoHyperlanePlaceholders('hyp_warp_token_usdg_v2.aleo', 1399811149), aleoRemoteRouterSolanaAddress: 'AhNVa6VpZwDwgD3U66CGUwCMRcFSFiTfBse2D495SPxW', hyperlaneConfigSource: USDG_HYPERLANE_CONFIG_SOURCE }, USDG_HYPERLANE_CONFIG_SOURCE),
  route('hyperlane:solana/zec->aleo/zec', 'hyperlane', 'mainnet', 'solana/zec', 'aleo/zec', 'metadata-required', 'ZEC/aleo', solanaCollateralDiscoveryMetadata('2RBzic8nUNJ8KngRRbsCEjkeM9CtpQN2CCqU1cs1n2y5', 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS', 'hyp_warp_token_zec_v2.aleo/aleo1m3z3en2msfdk62yje9ty7fqydxeakgx0ec6ze672q86p2yxq0sqqyjr9jd', ZEC_HYPERLANE_CONFIG_SOURCE), ZEC_HYPERLANE_CONFIG_SOURCE),
  route('hyperlane:aleo/zec->solana/zec', 'hyperlane', 'mainnet', 'aleo/zec', 'solana/zec', 'metadata-required', 'ZEC/aleo', { ...aleoHyperlanePlaceholders('hyp_warp_token_zec_v2.aleo', 1399811149), aleoRemoteRouterSolanaAddress: '2RBzic8nUNJ8KngRRbsCEjkeM9CtpQN2CCqU1cs1n2y5', hyperlaneConfigSource: ZEC_HYPERLANE_CONFIG_SOURCE }, ZEC_HYPERLANE_CONFIG_SOURCE),
  ...pair('hyperlane', 'mainnet', 'aleo/aleo', 'ethereum/aleo', 'metadata-required', 'ALEO/aleo', ALEO_MAILBOX_METADATA),
  ...pair('hyperlane', 'mainnet', 'aleo/aleo', 'solana/aleo', 'metadata-required', 'ALEO/aleo', ALEO_MAILBOX_METADATA),
  ...pair('hyperlane', 'mainnet', 'aleo/aleo', 'base/aleo', 'metadata-required', 'ALEO/aleo', ALEO_MAILBOX_METADATA),
  ...pair('hyperlane', 'mainnet', 'aleo/aleo', 'hyperevm/aleo', 'metadata-required', 'ALEO/aleo', ALEO_MAILBOX_METADATA),
  route('hyperlane:ethereum/usad->aleo/usad', 'hyperlane', 'mainnet', 'ethereum/usad', 'aleo/usad', 'metadata-required', 'USAD/aleo', ALEO_MAILBOX_METADATA),
  route('hyperlane:aleo/usad->ethereum/usad', 'hyperlane', 'mainnet', 'aleo/usad', 'ethereum/usad', 'metadata-required', 'USAD/aleo', aleoHyperlanePlaceholders('hyp_warp_token_usad_v2.aleo', 1)),
]

/**
 * Supplies the initial reviewed protocol-route snapshot.
 *
 * xReserve contract identifiers are populated from Circle's published
 * mainnet and testnet tables. Hyperlane routes intentionally remain
 * `metadata-required` until their router, domain, ISM, and token identifiers
 * are pinned from one reviewed registry commit. Reading this snapshot does not
 * contact any chain or bridge provider.
 *
 * @example
 * const bridge = createBridgeClient({ registry: DEFAULT_BRIDGE_REGISTRY })
 */
export const DEFAULT_BRIDGE_REGISTRY: BridgeRegistry = Object.freeze({
  version: '2026-09-28.cctp-arc.1',
  chains: Object.freeze(chains),
  assets: Object.freeze(assets),
  routes: Object.freeze(routes),
  sources: Object.freeze([XRESERVE_SOURCE, ALEO_XRESERVE_SOURCE, HYPERLANE_SOURCE, CCTP_SOURCE, USDC_SOURCE]),
  getAssets(this: BridgeRegistry, params = {}) {
    const chains = new Map(this.chains.map((chain) => [chain.id, chain]))
    const chainId = params.chainId?.toLowerCase()
    const symbol = params.symbol?.toLowerCase()
    return this.assets.filter((asset) => {
      const chain = chains.get(asset.chainId)
      return (
        (params.environment == null || chain?.environment === params.environment) &&
        (chainId == null || asset.chainId.toLowerCase() === chainId) &&
        (symbol == null || asset.symbol.toLowerCase() === symbol)
      )
    })
  },
  getRoutes(this: BridgeRegistry, params = {}) {
    const assets = new Map(this.assets.map((asset) => [asset.id, asset]))
    const sourceChainId = params.sourceChainId?.toLowerCase()
    const destinationChainId = params.destinationChainId?.toLowerCase()
    const symbol = params.symbol?.toLowerCase()
    return this.routes.filter((route) => {
      const source = assets.get(route.sourceAssetId)!
      const destination = assets.get(route.destinationAssetId)!
      return (
        (params.includeUnavailable === true || route.availability !== 'disabled') &&
        (params.environment == null || route.environment === params.environment) &&
        (params.protocol == null || route.protocol === params.protocol) &&
        (sourceChainId == null || source.chainId.toLowerCase() === sourceChainId) &&
        (destinationChainId == null || destination.chainId.toLowerCase() === destinationChainId) &&
        (symbol == null || source.symbol.toLowerCase() === symbol || destination.symbol.toLowerCase() === symbol)
      )
    })
  },
})
