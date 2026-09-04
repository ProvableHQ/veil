import { readFileSync } from 'node:fs'
import { prepareTransfer } from '../../src/actions/prepareTransfer.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import type { SolanaHyperlaneRouteMetadata } from '../../src/types/solana.js'
import type { BridgeRegistry } from '../../src/types/protocol.js'

// Shared golden-fixture helpers for the Solana Hyperlane action tests
// (`solanaRouteMetadata`, `quoteSolanaHyperlaneTransfer`, and
// `executeSolanaHyperlaneTransfer`), so each action's test file reads the
// same recorded mainnet transfer and IGP account.

export const SOLANA_ROUTE_ID = 'hyperlane:solana/sol->aleo/sol'

export const transferFixture = JSON.parse(
  readFileSync(new URL('./sealevel-transfer-remote.json', import.meta.url), 'utf8'),
) as {
  senderAddress: string
  recipientAleoAddress: string
  amountLamports: number
  accounts: { address: string; signer: boolean; writable: boolean }[]
  logMessages: string[]
}

export const igpFixture = JSON.parse(
  readFileSync(new URL('./sealevel-igp-account.json', import.meta.url), 'utf8'),
) as { address: string; dataBase64: string }

// Warp program id is not itself a fixture field; pinned in SEALEVEL_NOTES.md's intro.
export const WARP_PROGRAM_ADDRESS = '8YGT2pZwyZe94qBpGzWfY2TMEVcwaQ1bXAE7YAgpUaM7'

// SEALEVEL_NOTES.md §4: the exact lamport figure reproduced from the pinned
// formula, independently confirmed against the real deposit's observed
// lamport delta on the inner IGP account (1432395649 - 1429495649).
export const EXPECTED_IGP_PAYMENT_LAMPORTS = 2_900_000n
export const NETWORK_FEE_LAMPORTS = 10_000n

/**
 * Maps the golden fixture's ordered account list onto
 * `SolanaHyperlaneRouteMetadata`, per the static/per-transfer labels in
 * SEALEVEL_NOTES.md §2 — mirrors `metadataFromFixture` in
 * `test/solana/transferRemote.test.ts`.
 */
function metadataFromFixture(f: typeof transferFixture): SolanaHyperlaneRouteMetadata {
  const accounts = f.accounts
  return {
    warpProgramAddress: WARP_PROGRAM_ADDRESS,
    tokenPda: accounts[2]!.address,
    nativeCollateralPda: accounts[15]!.address,
    dispatchAuthorityPda: accounts[5]!.address,
    mailboxProgramAddress: accounts[3]!.address,
    mailboxOutboxPda: accounts[4]!.address,
    igpProgramAddress: accounts[9]!.address,
    igpProgramDataPda: accounts[10]!.address,
    igpOverheadAccount: accounts[12]!.address,
    igpAccount: accounts[13]!.address,
    splNoopProgramAddress: accounts[1]!.address,
    destinationDomain: 1634493807, // SEALEVEL_NOTES.md §1, Aleo mainnet's Hyperlane domain
    destinationGasAmount: '464000', // SEALEVEL_NOTES.md §4, token's destination_gas for this domain
    registryCommit: '418056e21734d26a7d14692e0ec5e902cc9e86bf',
    solanaReviewedAt: '2026-08-28T00:00:00Z',
    solanaConfigSource: 'hyperlane-registry@418056e2:deployments/warp_routes/SOL/aleo-config.yaml',
  }
}

/** Returns the default registry with the SOL route activated and its metadata (optionally overridden) attached. */
export function registryWithRoute(overrides: Partial<Record<string, string | number | boolean>> = {}): BridgeRegistry {
  const metadata = { ...metadataFromFixture(transferFixture), ...overrides }
  return {
    ...DEFAULT_BRIDGE_REGISTRY,
    routes: DEFAULT_BRIDGE_REGISTRY.routes.map((route) =>
      route.id === SOLANA_ROUTE_ID
        ? { ...route, availability: 'active' as const, metadata: metadata as unknown as Record<string, string | number | boolean> }
        : route,
    ),
  }
}

/** Prepares the fixture's recorded transfer (676.2 SOL to the recorded Aleo recipient) against the given registry. */
export function transferPlan(registry: BridgeRegistry) {
  return prepareTransfer(registry, {
    routeId: SOLANA_ROUTE_ID,
    amount: '676.2',
    recipient: transferFixture.recipientAleoAddress,
    sender: transferFixture.senderAddress,
  })
}

/** Decodes the recorded IGP account's base64 data into bytes. */
export function igpAccountData(): Uint8Array {
  return Uint8Array.from(atob(igpFixture.dataBase64), (char) => char.charCodeAt(0))
}
