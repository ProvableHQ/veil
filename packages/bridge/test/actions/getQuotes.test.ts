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
      srcChain: 'aleo',
      destChain: 'solana',
      srcAsset: 'ALEO',
      destAsset: 'SOL',
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
        srcChain: 'aleo',
        destChain: 'solana',
        srcAsset: 'ALEO',
        destAsset: 'SOL',
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
      srcChain: 'aleo',
      destChain: 'solana',
      srcAsset: 'ALEO',
      destAsset: 'SOL',
      amountIn: '1',
    })

    expect(result.meta.warnings).toEqual(['near minimum'])
    expect(result.meta.providerErrors).toEqual({ stale: { message: 'down' } })
  })

  it('defaults to empty meta when missing', async () => {
    const client = makeClient({ data: [] })
    const result = await getQuotes(client, {
      srcChain: 'aleo',
      destChain: 'solana',
      srcAsset: 'ALEO',
      destAsset: 'SOL',
      amountIn: '1',
    })
    expect(result.quotes).toEqual([])
    expect(result.meta).toEqual({})
  })

  it('throws BridgeEnvelopeError if data is missing', async () => {
    const client = makeClient({ meta: {} })
    await expect(
      getQuotes(client, {
        srcChain: 'aleo',
        destChain: 'solana',
        srcAsset: 'ALEO',
        destAsset: 'SOL',
        amountIn: '1',
      }),
    ).rejects.toThrow(BridgeEnvelopeError)
  })
})
