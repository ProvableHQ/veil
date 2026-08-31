import { readFileSync } from 'node:fs'
import { getTransactionDecoder } from '@solana/kit'
import { describe, expect, it, vi } from 'vitest'
import {
  executeSolanaHyperlaneTransfer,
  quoteSolanaHyperlaneTransfer,
  solanaRouteMetadata,
} from '../../src/actions/solanaHyperlane.js'
import { prepareTransfer } from '../../src/actions/prepareTransfer.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { BridgeError } from '../../src/errors/bridgeErrors.js'
import type { SolanaRpcReader } from '../../src/solana/rpc.js'
import type { SolanaBridgeExecutor, SolanaHyperlaneRouteMetadata } from '../../src/types/solana.js'
import type { BridgeRegistry } from '../../src/types/protocol.js'

const ROUTE_ID = 'hyperlane:solana/sol->aleo/sol'

const transferFixture = JSON.parse(
  readFileSync(new URL('../fixtures/sealevel-transfer-remote.json', import.meta.url), 'utf8'),
) as {
  senderAddress: string
  recipientAleoAddress: string
  amountLamports: number
  accounts: { address: string; signer: boolean; writable: boolean }[]
  logMessages: string[]
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

describe('executeSolanaHyperlaneTransfer', () => {
  const STUB_SIGNATURE = 'stub-signature'

  function stubExecutor(onSend?: (wireTransaction: Uint8Array) => void): SolanaBridgeExecutor {
    return {
      getAddress: async () => transferFixture.senderAddress,
      signAndSendTransaction: async (wireTransaction) => {
        onSend?.(wireTransaction)
        return { signature: STUB_SIGNATURE }
      },
    }
  }

  function executeRpc(overrides: Partial<SolanaRpcReader> = {}): SolanaRpcReader {
    return {
      getLatestBlockhash: async () => ({ blockhash: WARP_PROGRAM_ADDRESS, lastValidBlockHeight: 100n }),
      getBalance: async () => 800_000_000_000n,
      getAccountData: async () => igpAccountData(),
      getSignatureStatus: async () => 'confirmed',
      getTransactionLogs: async () => transferFixture.logMessages,
      ...overrides,
    }
  }

  it('signs, submits, confirms, and extracts the Hyperlane message id', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    let capturedWire: Uint8Array | undefined
    const executor = stubExecutor((wire) => { capturedWire = wire })
    const rpc = executeRpc()

    const execution = await executeSolanaHyperlaneTransfer(registry, executor, rpc, { plan })

    expect(execution.receipt.status).toBe('DELIVERY_PENDING')
    expect(execution.receipt.sourceTxId).toBe(STUB_SIGNATURE)
    expect(execution.receipt.messageId).toBe(
      '0xffe0409d00c184769b4dfa2a1eaac5a0a79bfe52458a38e1d9a71a9e5c677805',
    )
    expect(execution.receipt.id).toBe(execution.receipt.messageId)

    // Stage 5: the wire bytes handed to the executor already carry exactly
    // one signature — the unique message account's — proving the action
    // partially signs with the ephemeral keypair before dispatch.
    expect(capturedWire).toBeInstanceOf(Uint8Array)
    const decoded = getTransactionDecoder().decode(capturedWire!)
    const signedEntries = Object.entries(decoded.signatures).filter(([, signature]) => signature !== null)
    expect(signedEntries).toHaveLength(1)
    expect(signedEntries[0]?.[0]).toBe(execution.receipt.protocolState.uniqueMessageAddress)
  })

  it('throws a BridgeError describing the amount, gas, and rent split when balance is insufficient', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const executor = stubExecutor()
    const rpc = executeRpc({ getBalance: async () => 0n })

    try {
      await executeSolanaHyperlaneTransfer(registry, executor, rpc, { plan })
      expect.unreachable('expected an insufficient-balance BridgeError')
    } catch (error) {
      expect(error).toBeInstanceOf(BridgeError)
      const message = (error as BridgeError).message
      expect(message).toContain('balance 0 lamports')
      expect(message).toContain('amount 676200000000')
      expect(message).toContain('gas 2910000')
      expect(message).toContain('rent 4113360')
    }
  })

  it('throws a BridgeError naming the signature when the network reports failure', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const executor = stubExecutor()
    const rpc = executeRpc({ getSignatureStatus: async () => 'failed' })

    await expect(executeSolanaHyperlaneTransfer(registry, executor, rpc, { plan })).rejects.toThrow(
      new RegExp(STUB_SIGNATURE),
    )
  })

  it('returns a resumable SOURCE_CONFIRMING receipt on confirmation timeout, without throwing', async () => {
    vi.useFakeTimers()
    try {
      const registry = registryWithRoute()
      const plan = transferPlan(registry)
      const executor = stubExecutor()
      const rpc = executeRpc({ getSignatureStatus: async () => null })

      const executionPromise = executeSolanaHyperlaneTransfer(registry, executor, rpc, {
        plan,
        pollingIntervalMs: 1_000,
        confirmationTimeoutMs: 3_000,
      })

      // Advance in small increments until the action settles. A single large
      // advance can race ahead of the real (non-timer) async work the action
      // does before it starts polling — key generation, PDA derivation, and
      // transaction signing — since advancing past a moment with no pending
      // timer resolves near-instantly and does not wait for that work.
      let settled = false
      void executionPromise.then(() => { settled = true })
      for (let iteration = 0; iteration < 200 && !settled; iteration++) {
        await vi.advanceTimersByTimeAsync(100)
      }
      const execution = await executionPromise

      expect(execution.receipt.status).toBe('SOURCE_CONFIRMING')
      expect(execution.receipt.sourceTxId).toBe(STUB_SIGNATURE)
      expect(execution.receipt.messageId).toBeUndefined()
      expect(execution.receipt.id).toBe(STUB_SIGNATURE)
    } finally {
      vi.useRealTimers()
    }
  })
})
