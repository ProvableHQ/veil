import { describe, it, expect } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { httpBridge } from '../../src/transports/httpBridge.js'
import { TransportError } from '@veil/core'

/**
 * Real-API integration for the bridge client: every test hits the LIVE
 * wallet-services API and its enabled providers (NEAR Intents, Halliday,
 * Houdini) — quotes fan out to the providers' own quoting systems, so these
 * catch provider drift as well as API drift. Read-only: quotes and error
 * paths only; no orders are created and no funds move.
 *
 * Route availability shifts with provider enablement and liquidity — tests
 * assert invariants of whatever comes back, and only the flagship
 * ALEO → SOL route is required to actually quote.
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

  it('quotes the flagship ALEO → SOL route from real providers', async () => {
    const { quotes, meta } = await client.getQuotes({
      srcChain: 'ALEO',
      srcAsset: 'ALEO_MAINNET',
      destChain: 'SOLANA',
      destAsset: 'SOL_SOLANA',
      amountIn: '100',
      recipientAddress: SOL_ADDR,
      refundAddress: ALEO_ADDR,
    })

    expect(quotes.length).toBeGreaterThan(0)
    expect(meta.quoteRequestId).toBeTruthy()
    for (const q of quotes) {
      expect(q.provider.code).toBeTruthy()
      expect(q.srcAsset).toBe('ALEO_MAINNET')
      expect(q.destAsset).toBe('SOL_SOLANA')
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
      srcChain: 'EVM:1',
      srcAsset: 'USDC_ETH',
      destChain: 'ALEO',
      destAsset: 'USDC_ALEO',
      amountIn: '100',
      recipientAddress: ALEO_ADDR,
      refundAddress: ETH_ADDR,
    })

    // Inbound liquidity comes and goes — assert invariants, not availability.
    expect(meta.quoteRequestId).toBeTruthy()
    for (const q of quotes) {
      expect(Number(q.amountOut)).toBeGreaterThan(0)
      expect(q.destAsset).toBe('USDC_ALEO')
    }
  }, 90_000)

  it('omitting recipient/refund addresses narrows the provider fan-out but still succeeds', async () => {
    const { quotes, meta } = await client.getQuotes({
      srcChain: 'ALEO',
      srcAsset: 'ALEO_MAINNET',
      destChain: 'SOLANA',
      destAsset: 'SOL_SOLANA',
      amountIn: '100',
    })

    // NEAR Intents (and possibly others) skip quoting without addresses; the
    // request itself must still succeed with a well-formed envelope.
    expect(Array.isArray(quotes)).toBe(true)
    expect(meta.quoteRequestId).toBeTruthy()
  }, 90_000)

  it('rejects a bare symbol as an asset code', async () => {
    await expect(
      client.getQuotes({
        srcChain: 'ALEO',
        srcAsset: 'ALEO', // must be chain-qualified: ALEO_MAINNET
        destChain: 'SOLANA',
        destAsset: 'SOL_SOLANA',
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
