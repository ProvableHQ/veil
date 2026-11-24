import { DEFAULT_BRIDGE_REGISTRY, type BridgeRegistry, type ProtocolBridgeRoute } from '@provablehq/aleo-bridge-sdk'

const TOOLKIT_COMMIT = '463c16a0a0b9a93e7aac678146518a5d5e9d7876'
const REGISTRY_COMMIT = '418056e21734d26a7d14692e0ec5e902cc9e86bf'
const SOURCE = `https://github.com/ProvableHQ/aleo-dev-toolkit/tree/${TOOLKIT_COMMIT}/examples/hyperlane-bridge`
const WARP = 'test_hyp_warp_token_eth_v2.aleo'
const TOKEN = 'test_arc20_eth.aleo'
const FREEZELIST = 'shield_arc22_freezelist.aleo'
const ZERO = `aleo1${'q'.repeat(52)}3ljyzc`
const ROUTER = '0x7c4aAAaB1f846881af95f5736d127F3F3F07F25F'
const DEFAULT_HOOK = 'aleo175xvd3uqmswt9ckt2d4drnxrqu8gzuzz3u3cjlt3cxhru74d2qqsnf5t46'
const REQUIRED_HOOK = 'aleo1k45pt4auhdr27hlep9pg47w82nn7vzt2g8tmcxc4gpas25fdrugsapnyvh'

// Snapshot read from testnet on 2026-11-24. Execution compares live outbound
// state with these values; changes require reviewing and updating this file.
const metadata = {
  sourceChainId: 11155111,
  destinationDomain: 1617853565,
  routerAddress: ROUTER,
  routerType: 'native',
  destinationRouter: `${WARP}/aleo1lmdxa8hgfwmdn7llh60k36j870jsmsc3wy6dmltu8enwpa4fsvyskdh4sg`,
  mailboxAddress: '0xfFAEF09B3cd11D9b20d1a19bECca54EEC2884766',
  interchainGasPaymaster: '0x6f2756380FD49228ae25Aa7F2817993cB74Ecc56',
  interchainSecurityModule: '0x0000000000000000000000000000000000000000',
  registryCommit: REGISTRY_COMMIT,
  privateMintEncoding: 'address_commitment_v1',
  privateMintAbi: 'claim_private_v1',
  privateMintProgram: WARP,
  privateMintMapping: 'claimable',
  privateMintFreezelistProgram: FREEZELIST,
  privateMintCommit: TOOLKIT_COMMIT,
  aleoRouterProgram: WARP,
  aleoDestinationDomain: 11155111,
  aleoTokenType: '1',
  aleoTokenOwner: 'aleo1yr3k99my65ec7a97a9n8tqqmr7ef687x3vthv68ezats30hcgvgs2f8ac5',
  aleoIsm: ZERO,
  aleoHook: ZERO,
  aleoTokenId: '4303445653646867681585384360733743097743350158501737605273465632410968185598field',
  aleoLocalDecimals: 18,
  aleoRemoteDecimals: 18,
  aleoRemoteRouterRecipient: `[${Array.from(Buffer.from(ROUTER.slice(2).padStart(64, '0'), 'hex'), value => `${value}u8`).join(', ')}]`,
  aleoRemoteRouterGas: '60000',
  aleoMailboxProgram: 'test_hyp_mailbox.aleo',
  aleoHookManagerProgram: 'test_hyp_hook_manager.aleo',
  aleoMailboxDefaultHook: DEFAULT_HOOK,
  aleoMailboxRequiredHook: REQUIRED_HOOK,
  aleoPlaceholderConfiguration: false,
  aleoPrivateTransferAbi: 'transfer_remote_private_v1',
  aleoPrivateTransferCommit: TOOLKIT_COMMIT,
  aleoPrivateTransferFeeMapping: 'private_transfer_fee_bps__',
  aleoPrivateTransferFeeKey: 'false',
  aleoPrivateTransferExecutionVerified: true,
  aleoPrivateTransferTokenProgram: TOKEN,
  aleoPrivateTransferFreezelistProgram: FREEZELIST,
  aleoPrivateTransferPauseMapping: 'bridge_pause',
  aleoPrivateTransferPauseKey: 'true',
  // The CLI checks the actual deployed Aleo instructions before any submission.
  programSourceSha256: '7f3745281b7db1ba833cef502ccdb7e1ba04f0f213df24e2a6b9650c16091a41',
  deploymentReviewedAt: '2026-11-24',
  ...Object.fromEntries(Array.from({ length: 4 }, (_, index) => [
    [`aleoAllowanceSpender${index}`, index === 0 ? DEFAULT_HOOK : ZERO],
    [`aleoAllowanceAmount${index}`, '0'],
  ]).flat()),
}
const routes: ProtocolBridgeRoute[] = [
  ['sepolia/eth', 'aleo-testnet/eth'],
  ['aleo-testnet/eth', 'sepolia/eth'],
].map(([sourceAssetId, destinationAssetId]) => ({
  id: `hyperlane:${sourceAssetId}->${destinationAssetId}`,
  protocol: 'hyperlane', environment: 'testnet', availability: 'active',
  sourceAssetId: sourceAssetId!, destinationAssetId: destinationAssetId!,
  deploymentId: 'ETH/aleotestnet', source: SOURCE, metadata,
  pauseSources: [{ chainId: 'aleo-testnet', kind: 'aleo-mapping', program: WARP, mapping: 'pause', key: 'true' }],
}))

/**
 * Supplies the reviewed Sepolia ETH and Aleo testnet private bridge deployment.
 * Contains only the two testnet directions; construction performs no network
 * reads. The ABI selectors activate the SDK's existing five- and eleven-input
 * builders, rather than supplying arbitrary ABI definitions.
 * @example const bridge = createBridgeClient({ registry: TESTNET_ETH_REGISTRY, clients })
 */
export const TESTNET_ETH_REGISTRY: BridgeRegistry = {
  ...DEFAULT_BRIDGE_REGISTRY,
  version: '2026-11-24.testnet-private-eth.1',
  chains: [
    { id: 'sepolia', displayName: 'Sepolia', family: 'evm', environment: 'testnet', nativeCurrencySymbol: 'ETH', protocolDomains: { hyperlane: 11155111 } },
    { id: 'aleo-testnet', displayName: 'Aleo Testnet', family: 'aleo', environment: 'testnet', nativeCurrencySymbol: 'ALEO', protocolDomains: { hyperlane: 1617853565 } },
  ],
  assets: [
    { id: 'sepolia/eth', key: 'eth', chainId: 'sepolia', symbol: 'ETH', name: 'Sepolia Ether', decimals: 18, kind: 'native', locator: { kind: 'native', value: 'ETH' }, addressValidationRegex: '^0x[0-9a-fA-F]{40}$' },
    { id: 'aleo-testnet/eth', key: 'eth', chainId: 'aleo-testnet', symbol: 'ETH', name: 'Testnet wrapped Ether', decimals: 18, kind: 'token', locator: { kind: 'aleo-program', value: WARP }, addressValidationRegex: '^aleo1[0-9a-z]{58}$', privacy: { kind: 'arc22', program: TOKEN, freezelistProgram: FREEZELIST } },
  ],
  routes,
  sources: [SOURCE, `https://github.com/hyperlane-xyz/hyperlane-registry/blob/${REGISTRY_COMMIT}/deployments/warp_routes/ETH/aleotestnet-config.yaml`],
}
