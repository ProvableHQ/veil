import { describe, it, expect, beforeAll } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { httpBridge } from '../../src/transports/httpBridge.js'
import { TransportError } from '@veil/core'
import type { BridgeAssetSummary } from '../../src/types/bridge.js'

/**
 * Real-API integration for the bridge client: every test hits the LIVE
 * wallet-services API and its enabled providers (NEAR Intents, Halliday,
 * Houdini) — quotes fan out to the providers' own quoting systems, so these
 * catch provider drift as well as API drift. Read-only: quotes and error
 * paths only; no orders are created and no funds move.
 *
 * Identifiers are DISCOVERED, not hardcoded: beforeAll resolves the assets
 * under test from getAssets() by symbol + chain semantics, the same way a
 * consumer should. Route availability shifts with provider enablement and
 * liquidity — tests assert invariants of whatever comes back, and only the
 * flagship native-ALEO → native-SOL route is required to actually quote.
 *
 * Requirements: VEIL_INTEGRATION=1. Optional: VEIL_BRIDGE_API_URL to point
 * at a non-production deployment.
 */
const RUN = process.env.VEIL_INTEGRATION === '1'
const API_URL = process.env.VEIL_BRIDGE_API_URL ?? 'https://wallet.api.provable.com'

// The e2e test wallets, used for quoting (no funds move on a quote).
// Providers skip quoting without recipient/refund addresses.
const ALEO_ADDR = 'aleo1uusf3j8kz9mkwtj00v4zv8tnqdkfzjjh3nkaz98vjj7zpn44wg9qz3xjum'
const SOL_ADDR = '9TtLbwEUUQ677hQ6RdnCCkt1MbBaMjG4Ht4isx56nNnt'
const ETH_ADDR = '0x734C0a5AB55885974cEDb9D6ff71d8E8448c7375'

describe.runIf(RUN)('bridge client against the live wallet-services API', () => {
  const client = createBridgeClient({ transport: httpBridge(API_URL) })

  // Resolved from the live catalog — the discovery path consumers should use.
  let assets: BridgeAssetSummary[]
  let aleo: BridgeAssetSummary // native ALEO
  let sol: BridgeAssetSummary // native SOL on Solana
  let usdcEth: BridgeAssetSummary // USDC on Ethereum mainnet
  let usdcAleo: BridgeAssetSummary // USDC bridged onto Aleo

  function resolve(what: string, pred: (a: BridgeAssetSummary) => boolean): BridgeAssetSummary {
    const found = assets.find(pred)
    expect(found, `asset catalog no longer lists ${what}`).toBeTruthy()
    return found!
  }

  beforeAll(async () => {
    assets = await client.getAssets()
    aleo = resolve('native ALEO', (a) => a.chain === 'ALEO' && a.native)
    sol = resolve('native SOL on SOLANA', (a) => a.chain === 'SOLANA' && a.native)
    usdcEth = resolve('USDC on EVM:1', (a) => a.symbol === 'USDC' && a.chain === 'EVM:1')
    usdcAleo = resolve('USDC on ALEO', (a) => a.symbol === 'USDC' && a.chain === 'ALEO')
  }, 30_000)

  it('serves a coherent asset catalog: codes, chains, decimals, address regexes', () => {
    expect(assets.length).toBeGreaterThan(0)
    // Every entry carries a chain-qualified code, its chain, and decimals —
    // this is where srcAsset/srcChain values come from.
    for (const a of assets) {
      expect(a.code).toBeTruthy()
      expect(a.chain).toBeTruthy()
      expect(typeof a.decimals).toBe('number')
    }
    // The catalog's validation regexes accept the test wallets — the same
    // check a UI would run before quoting.
    if (aleo.walletValidationRegex) expect(ALEO_ADDR).toMatch(new RegExp(aleo.walletValidationRegex))
    if (sol.walletValidationRegex) expect(SOL_ADDR).toMatch(new RegExp(sol.walletValidationRegex))
    if (usdcEth.walletValidationRegex) expect(ETH_ADDR).toMatch(new RegExp(usdcEth.walletValidationRegex))
  })

  it('serves the provider registry with at least one bridge provider', async () => {
    const providers = await client.getProviders()
    expect(providers.some((p) => p.capabilities.includes('BRIDGE'))).toBe(true)
    // The flagship source asset names at least one of those providers as
    // supporting it — the per-asset half of discovery.
    expect((aleo.supportedProviders ?? []).length).toBeGreaterThan(0)
  }, 30_000)

  it('quotes the flagship native-ALEO → native-SOL route from real providers', async () => {
    const { quotes, meta } = await client.getQuotes({
      srcChain: aleo.chain,
      srcAsset: aleo.code,
      destChain: sol.chain,
      destAsset: sol.code,
      amountIn: '100',
      recipientAddress: SOL_ADDR,
      refundAddress: ALEO_ADDR,
    })

    expect(quotes.length).toBeGreaterThan(0)
    expect(meta.quoteRequestId).toBeTruthy()
    for (const q of quotes) {
      expect(q.provider.code).toBeTruthy()
      expect(q.srcAsset).toBe(aleo.code)
      expect(q.destAsset).toBe(sol.code)
      expect(Number(q.amountOut)).toBeGreaterThan(0)
      // A quote must be actionable: it needs the id createOrder requires.
      expect(q.quoteId ?? q.quoteOptionId).toBeTruthy()
      if (q.minAmountOut != null) {
        expect(Number(q.minAmountOut)).toBeLessThanOrEqual(Number(q.amountOut))
      }
    }
  }, 90_000)

  it('quotes an inbound route (USDC on Ethereum → USDC on Aleo)', async () => {
    const { quotes, meta } = await client.getQuotes({
      srcChain: usdcEth.chain,
      srcAsset: usdcEth.code,
      destChain: usdcAleo.chain,
      destAsset: usdcAleo.code,
      amountIn: '100',
      recipientAddress: ALEO_ADDR,
      refundAddress: ETH_ADDR,
    })

    // Inbound liquidity comes and goes — assert invariants, not availability.
    expect(meta.quoteRequestId).toBeTruthy()
    for (const q of quotes) {
      expect(Number(q.amountOut)).toBeGreaterThan(0)
      expect(q.destAsset).toBe(usdcAleo.code)
    }
  }, 90_000)

  it('omitting recipient/refund addresses narrows the provider fan-out but still succeeds', async () => {
    const { quotes, meta } = await client.getQuotes({
      srcChain: aleo.chain,
      srcAsset: aleo.code,
      destChain: sol.chain,
      destAsset: sol.code,
      amountIn: '100',
    })

    // NEAR Intents (and possibly others) skip quoting without addresses; the
    // request itself must still succeed with a well-formed envelope.
    expect(Array.isArray(quotes)).toBe(true)
    expect(meta.quoteRequestId).toBeTruthy()
  }, 90_000)

  it('rejects a bare symbol as an asset code', async () => {
    // Deliberately NOT from the catalog: the bare symbol is the mistake the
    // API must reject (the catalog's code for this asset is chain-qualified).
    expect(aleo.symbol).not.toBe(aleo.code)
    await expect(
      client.getQuotes({
        srcChain: aleo.chain,
        srcAsset: aleo.symbol, // e.g. 'ALEO' — must be aleo.code
        destChain: sol.chain,
        destAsset: sol.code,
        amountIn: '1',
      }),
    ).rejects.toThrow(TransportError)
  }, 30_000)

  it('throws for an unknown order id', async () => {
    await expect(client.getOrder({ id: '00000000-0000-0000-0000-000000000000' })).rejects.toThrow(
      TransportError,
    )
  }, 30_000)

  it('serves feature flags (skipped while the deployment predates /bridge/flags)', async (ctx) => {
    let flags
    try {
      flags = await client.getFlags()
    } catch (err) {
      // Production can lag the API repo; a 404 means the deployment predates
      // the flags endpoint, which is not a client bug.
      if (err instanceof TransportError && err.message.includes('404')) return ctx.skip()
      throw err
    }
    expect(typeof flags.near_supports_pub_priv_swaps).toBe('boolean')
  }, 30_000)
})
