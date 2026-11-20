import type { BridgeRegistry } from '../../src/types/protocol.js'

// Synthetic reviewed deployment for deterministic tests only. Production
// registry routes remain public-only until their deployed claim ABI is verified.
export const PRIVATE_MINT_METADATA = {
  privateMintEncoding: 'address_commitment_v1',
  privateMintAbi: 'claim_private_v1',
  privateMintProgram: 'test_hyp_warp_token_eth_v2.aleo',
  privateMintMapping: 'claimable',
  privateMintFreezelistProgram: 'shield_arc22_freezelist.aleo',
  privateMintCommit: 'ba0ae75fea7a39b1cbde04736d51a43dc8a1ae44',
  destinationRouter: 'test_hyp_warp_token_eth_v2.aleo',
  aleoMailboxProgram: 'hyp_mailbox.aleo',
} as const

export const COMMITMENT_HEX = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'

export function withPrivateMint(registry: BridgeRegistry, routeId: string): BridgeRegistry {
  return { ...registry, routes: registry.routes.map(route => route.id === routeId
    ? { ...route, metadata: { ...route.metadata, ...PRIVATE_MINT_METADATA } } : route) }
}
