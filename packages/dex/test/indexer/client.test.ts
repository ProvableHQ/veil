import { describe, it, expect, vi } from 'vitest'
import { IndexerClient, IndexerError, DEFAULT_INDEXER_URL } from '../../src/indexer/client.js'

function fetchMock(responses: Array<{ status?: number; json: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let i = 0
  const impl = vi.fn(async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const r = responses[Math.min(i++, responses.length - 1)]!
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('IndexerClient', () => {
  it('builds URLs with query params and skips undefined', async () => {
    const { impl, calls } = fetchMock([{ json: { data: [], pagination: { total: 0, limit: 5, offset: 0 } } }])
    const client = new IndexerClient({ fetch: impl })
    await client.getPools({ limit: 5, offset: undefined })
    expect(calls[0]!.url).toBe(`${DEFAULT_INDEXER_URL}/pools?limit=5`)
  })

  it('serializes bigint route amounts as strings', async () => {
    const { impl, calls } = fetchMock([{ json: { data: {} } }])
    const client = new IndexerClient({ fetch: impl })
    await client.getRoute({ token_in: '1field', token_out: '2field', amount_in: 10n ** 18n })
    expect(calls[0]!.url).toContain('amount_in=1000000000000000000')
  })

  it('authenticate: challenge → sign → verify → bearer attached to gated calls', async () => {
    const { impl, calls } = fetchMock([
      { json: { data: { message: 'sign me', nonce: 'n1' } } },
      { json: { data: { token: 'jwt123' } } },
      { json: { data: { address: '1field', name: 'T', symbol: 'T', decimals: 6 } } },
    ])
    const client = new IndexerClient({ fetch: impl })
    const sign = vi.fn(async (m: string) => `sign1-over-${m}`)
    const token = await client.authenticate('aleo1me', sign)

    expect(token).toBe('jwt123')
    expect(sign).toHaveBeenCalledWith('sign me')
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ address: 'aleo1me', signature: 'sign1-over-sign me' })

    await client.registerToken({ address: '1field', name: 'T', symbol: 'T', decimals: 6 })
    expect((calls[2]!.init.headers as Record<string, string>).authorization).toBe('Bearer jwt123')
  })

  it('auth-gated calls without a token fail fast with the remedy', async () => {
    const client = new IndexerClient({ fetch: fetchMock([{ json: {} }]).impl })
    await expect(client.registerToken({ address: '1field', name: 'T', symbol: 'T', decimals: 6 })).rejects.toThrow(
      /requires auth — call authenticate/,
    )
  })

  it('non-2xx surfaces as IndexerError with status and body', async () => {
    const { impl } = fetchMock([{ status: 404, json: { error: 'no such pool' } }])
    const client = new IndexerClient({ fetch: impl })
    await expect(client.getPool('9field')).rejects.toThrow(IndexerError)
    await expect(client.getPool('9field')).rejects.toThrow(/404/)
  })
})
