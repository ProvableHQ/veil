import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  quoteSolanaHyperlaneTransfer,
  solanaRouteMetadata,
} from '../../src/actions/solanaHyperlane.js'
import { prepareTransfer } from '../../src/actions/prepareTransfer.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { BridgeError } from '../../src/errors/bridgeErrors.js'
import type { SolanaRpcReader } from '../../src/solana/rpc.js'
import type { SolanaHyperlaneRouteMetadata } from '../../src/types/solana.js'
import type { BridgeRegistry } from '../../src/types/protocol.js'

const ROUTE_ID = 'hyperlane:solana/sol->aleo/sol'

const transferFixture = JSON.parse(
  readFileSync(new URL('../fixtures/sealevel-transfer-remote.json', import.meta.url), 'utf8'),
) as {
  senderAddress: string
  recipientAleoAddress: string
  amountLamports: number
  accounts: { address: string; signer: boolean; writable: boolean }[]
}

const igpFixture = JSON.parse(
  readFileSync(new URL('../fixtures/sealevel-igp-account.json', import.meta.url), 'utf8'),
) as { address: string; dataBase64: string }

// Warp program id is not itself a fixture field; pinned in SEALEVEL_NOTES.md's intro.
const WARP_PROGRAM_ADDRESS = '8YGT2pZwyZe94qBpGzWfY2TMEVcwaQ1bXAE7YAgpUaM7'

// SEALEVEL_NOTES.md §4: the exact lamport figure reproduced from the pinned
// formula, independently confirmed against the real deposit's observed
// lamport delta on the inner IGP account (1432395649 - 1429495649).
const EXPECTED_IGP_PAYMENT_LAMPORTS = 2_900_000n
const NETWORK_FEE_LAMPORTS = 10_000n

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

function registryWithRoute(overrides: Partial<Record<string, string | number | boolean>> = {}): BridgeRegistry {
  const metadata = { ...metadataFromFixture(transferFixture), ...overrides }
  return {
    ...DEFAULT_BRIDGE_REGISTRY,
    routes: DEFAULT_BRIDGE_REGISTRY.routes.map((route) =>
      route.id === ROUTE_ID
        ? { ...route, availability: 'active' as const, metadata: metadata as unknown as Record<string, string | number | boolean> }
        : route,
    ),
  }
}

function transferPlan(registry: BridgeRegistry) {
  return prepareTransfer(registry, {
    routeId: ROUTE_ID,
    amount: '676.2',
    recipient: transferFixture.recipientAleoAddress,
    sender: transferFixture.senderAddress,
  })
}

function rpcReturning(accountData: Uint8Array | null): SolanaRpcReader {
  return {
    getLatestBlockhash: () => { throw new Error('not used by quoteSolanaHyperlaneTransfer') },
    getBalance: () => { throw new Error('not used by quoteSolanaHyperlaneTransfer') },
    getAccountData: async () => accountData,
    getSignatureStatus: () => { throw new Error('not used by quoteSolanaHyperlaneTransfer') },
    getTransactionLogs: () => { throw new Error('not used by quoteSolanaHyperlaneTransfer') },
  }
}

function igpAccountData(): Uint8Array {
  return Uint8Array.from(atob(igpFixture.dataBase64), (char) => char.charCodeAt(0))
}

describe('solanaRouteMetadata', () => {
  it('rejects a plan built for a different protocol', () => {
    const registry = registryWithRoute()
    const plan = { ...transferPlan(registry), protocol: 'xreserve' as const }
    expect(() => solanaRouteMetadata(registry, plan)).toThrow(BridgeError)
  })

  it('rejects a plan built from a mismatched registry version', () => {
    const registry = registryWithRoute()
    const plan = { ...transferPlan(registry), registryVersion: 'not-the-configured-version' }
    expect(() => solanaRouteMetadata(registry, plan)).toThrow(BridgeError)
  })

  it('rejects a route that is not active', () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const inactiveRegistry: BridgeRegistry = {
      ...registry,
      routes: registry.routes.map((route) =>
        route.id === ROUTE_ID ? { ...route, availability: 'metadata-required' as const } : route,
      ),
    }
    expect(() => solanaRouteMetadata(inactiveRegistry, plan)).toThrow(BridgeError)
  })

  it('rejects metadata with a malformed IGP account address', () => {
    const registry = registryWithRoute({ igpAccount: 'not-a-solana-address' })
    const plan = transferPlan(registry)
    expect(() => solanaRouteMetadata(registry, plan)).toThrow(BridgeError)
  })

  it('returns the validated metadata for a well-formed active route', () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const metadata = solanaRouteMetadata(registry, plan)
    expect(metadata.igpAccount).toBe(igpFixture.address)
    expect(metadata.destinationDomain).toBe(1634493807)
    expect(metadata.destinationGasAmount).toBe('464000')
  })
})

describe('quoteSolanaHyperlaneTransfer', () => {
  it('quotes amount, IGP payment, network fee, and total from the IGP oracle account', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const rpc = rpcReturning(igpAccountData())

    const quote = await quoteSolanaHyperlaneTransfer(registry, rpc, { plan })

    expect(quote.routeId).toBe(ROUTE_ID)
    expect(quote.amountLamports).toBe(BigInt(transferFixture.amountLamports))
    expect(quote.igpPaymentLamports).toBe(EXPECTED_IGP_PAYMENT_LAMPORTS)
    expect(quote.networkFeeLamports).toBe(NETWORK_FEE_LAMPORTS)
    expect(quote.totalLamports).toBe(
      BigInt(transferFixture.amountLamports) + EXPECTED_IGP_PAYMENT_LAMPORTS + NETWORK_FEE_LAMPORTS,
    )
  })

  it('throws a BridgeError when the configured IGP account cannot be read', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const rpc = rpcReturning(null)

    await expect(quoteSolanaHyperlaneTransfer(registry, rpc, { plan })).rejects.toThrow(BridgeError)
  })

  it('propagates route validation failures without touching the network', async () => {
    const registry = registryWithRoute()
    const plan = { ...transferPlan(registry), protocol: 'xreserve' as const }
    const rpc = rpcReturning(igpAccountData())

    await expect(quoteSolanaHyperlaneTransfer(registry, rpc, { plan })).rejects.toThrow(BridgeError)
  })
})
