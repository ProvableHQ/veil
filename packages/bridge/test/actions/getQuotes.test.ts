import { describe, it, expect, vi } from 'vitest'
import { getQuotes } from '../../src/actions/getQuotes.js'
import { BridgeEnvelopeError } from '../../src/errors/bridgeErrors.js'
import type { Client } from '@veil/core'

function makeClient(response: unknown): Client {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as Client
}

function makeQuote(over: Partial<unknown> = {}): unknown {
  return {
    provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
    quoteId: 'q1',
    srcChain: 'aleo',
    destChain: 'solana',
    srcAsset: 'ALEO',
    destAsset: 'SOL',
    amountIn: '1',
    amountOut: '0.05',
    ...(over as object),
  }
}

describe('getQuotes', () => {
  it('returns quotes + meta on success', async () => {
    const client = makeClient({
      data: [makeQuote()],
      meta: { count: 1, quoteRequestId: 'req-1' },
    })

    const result = await getQuotes(client, {
      srcChain: 'ALEO',
      destChain: 'SOLANA',
      srcAsset: 'ALEO_MAINNET',
      destAsset: 'SOL_SOLANA',
      amountIn: '1',
      recipientAddress: '8xJ...',
    })

    expect(result.quotes).toHaveLength(1)
    expect(result.quotes[0].quoteId).toBe('q1')
    expect(result.meta.quoteRequestId).toBe('req-1')
    expect(result.meta.count).toBe(1)
    expect((client.request as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      method: 'getBridgeQuotes',
      params: expect.objectContaining({
        srcChain: 'ALEO',
        destChain: 'SOLANA',
        srcAsset: 'ALEO_MAINNET',
        destAsset: 'SOL_SOLANA',
        amountIn: '1',
      }),
    })
  })

  it('passes through providerErrors and warnings via meta', async () => {
    const client = makeClient({
      data: [],
      meta: {
        count: 0,
        quoteRequestId: 'req-2',
        warnings: ['near minimum'],
        providerErrors: { stale: { message: 'down' } },
      },
    })

    const result = await getQuotes(client, {
      srcChain: 'ALEO',
      destChain: 'SOLANA',
      srcAsset: 'ALEO_MAINNET',
      destAsset: 'SOL_SOLANA',
      amountIn: '1',
    })

    expect(result.meta.warnings).toEqual(['near minimum'])
    expect(result.meta.providerErrors).toEqual({ stale: { message: 'down' } })
  })

  it('resolves chain names and asset symbols before hitting the quotes endpoint', async () => {
    const request = vi.fn().mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'getBridgeAssets') {
        return {
          data: [
            { id: '1', code: 'ALEO_MAINNET', chain: 'ALEO', symbol: 'ALEO', decimals: 6, native: true },
            { id: '2', code: 'SOL_SOLANA', chain: 'SOLANA', symbol: 'SOL', decimals: 9, native: true },
          ],
        }
      }
      return { data: [], meta: { count: 0, quoteRequestId: 'r' } }
    })
    const client = { request } as unknown as Client

    await getQuotes(client, {
      srcChain: 'Aleo',      // display name
      srcAsset: 'ALEO',      // symbol
      destChain: 'Solana',   // display name
      destAsset: 'SOL',      // symbol
      amountIn: '1',
    })

    expect(request).toHaveBeenCalledWith({
      method: 'getBridgeQuotes',
      params: expect.objectContaining({
        srcChain: 'ALEO',
        srcAsset: 'ALEO_MAINNET',
        destChain: 'SOLANA',
        destAsset: 'SOL_SOLANA',
      }),
    })
  })

  it('does not fetch the catalog when exact codes are passed', async () => {
    const client = makeClient({ data: [], meta: { count: 0, quoteRequestId: 'r' } })
    await getQuotes(client, {
      srcChain: 'ALEO',
      srcAsset: 'ALEO_MAINNET',
      destChain: 'SOLANA',
      destAsset: 'SOL_SOLANA',
      amountIn: '1',
    })
    const methods = (client.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].method)
    expect(methods).toEqual(['getBridgeQuotes'])
  })

  it('throws BridgeEnvelopeError when meta lacks quoteRequestId', async () => {
    // Every quote response carries a quoteRequestId; downstream code (swap's
    // return value, support flows) relies on it — a silent {} would surface
    // later as an undefined field the types promise is a string.
    const client = makeClient({ data: [] })
    await expect(
      getQuotes(client, {
        srcChain: 'ALEO',
        destChain: 'SOLANA',
        srcAsset: 'ALEO_MAINNET',
        destAsset: 'SOL_SOLANA',
        amountIn: '1',
      }),
    ).rejects.toThrow(BridgeEnvelopeError)
  })

  it('throws BridgeEnvelopeError if data is missing', async () => {
    const client = makeClient({ meta: {} })
    await expect(
      getQuotes(client, {
        srcChain: 'ALEO',
        destChain: 'SOLANA',
        srcAsset: 'ALEO_MAINNET',
        destAsset: 'SOL_SOLANA',
        amountIn: '1',
      }),
    ).rejects.toThrow(BridgeEnvelopeError)
  })
})
