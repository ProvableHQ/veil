import { describe, it, expect, vi } from 'vitest'
import { httpBridge } from '../../src/transports/httpBridge.js'

function makeFetchMock(response: { ok: boolean; status?: number; body: unknown }) {
  return vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    text: async () => JSON.stringify(response.body),
    json: async () => response.body,
  })) as unknown as typeof fetch
}

describe('httpBridge transport', () => {
  it('builds GET /bridge/quotes with src/dest query params', async () => {
    const fetchFn = makeFetchMock({ ok: true, body: { data: [] } })
    const transport = httpBridge('https://wsa.example/api', { fetchFn })

    await transport.request({
      method: 'getBridgeQuotes',
      params: {
        srcChain: 'aleo',
        destChain: 'solana',
        srcAsset: 'ALEO',
        destAsset: 'SOL',
        amountIn: '1.0',
        recipientAddress: '8xJ...',
      },
    })

    const [url, init] = (fetchFn as any).mock.calls[0]
    expect(url).toMatch(/^https:\/\/wsa\.example\/api\/bridge\/quotes\?/)
    expect(url).toContain('srcChain=aleo')
    expect(url).toContain('destChain=solana')
    expect(url).toContain('srcAsset=ALEO')
    expect(url).toContain('destAsset=SOL')
    expect(url).toContain('amountIn=1.0')
    expect(url).toContain('recipientAddress=8xJ...')
    expect(init.method).toBe('GET')
  })

  it('omits absent optional quote params', async () => {
    const fetchFn = makeFetchMock({ ok: true, body: { data: [] } })
    const transport = httpBridge('https://wsa.example/api', { fetchFn })

    await transport.request({
      method: 'getBridgeQuotes',
      params: {
        srcChain: 'aleo',
        destChain: 'solana',
        srcAsset: 'ALEO',
        destAsset: 'SOL',
        amountIn: '1.0',
      },
    })

    const [url] = (fetchFn as any).mock.calls[0]
    expect(url).not.toContain('slippageBps')
    expect(url).not.toContain('recipientAddress')
  })

  it('POSTs JSON body to /bridge/orders with all required fields and optional x-timezone header', async () => {
    const fetchFn = makeFetchMock({ ok: true, body: { data: { orderId: 'o1' } } })
    const transport = httpBridge('https://wsa.example/api', { fetchFn })

    await transport.request({
      method: 'createBridgeOrder',
      params: {
        providerId: 'p1',
        srcChain: 'aleo',
        destChain: 'solana',
        srcAsset: 'ALEO',
        destAsset: 'SOL',
        amountIn: '1.5',
        walletAddress: '8xJ...',
        quoteId: 'q1',
        timezone: 'America/New_York',
      },
    })

    const [url, init] = (fetchFn as any).mock.calls[0]
    expect(url).toBe('https://wsa.example/api/bridge/orders')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers['x-timezone']).toBe('America/New_York')
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      providerId: 'p1',
      srcChain: 'aleo',
      destChain: 'solana',
      srcAsset: 'ALEO',
      destAsset: 'SOL',
      amountIn: '1.5',
      walletAddress: '8xJ...',
      quoteId: 'q1',
    })
    expect(body).not.toHaveProperty('timezone')
  })

  it('omits x-timezone header when timezone is not provided', async () => {
    const fetchFn = makeFetchMock({ ok: true, body: { data: {} } })
    const transport = httpBridge('https://wsa.example/api', { fetchFn })

    await transport.request({
      method: 'createBridgeOrder',
      params: { providerId: 'p1', srcChain: 'aleo', destChain: 'solana', srcAsset: 'ALEO', destAsset: 'SOL', amountIn: '1', walletAddress: 'w', quoteId: 'q1' },
    })

    const [, init] = (fetchFn as any).mock.calls[0]
    expect(init.headers['x-timezone']).toBeUndefined()
  })

  it('GETs /bridge/orders/{id}', async () => {
    const fetchFn = makeFetchMock({ ok: true, body: { data: {} } })
    const transport = httpBridge('https://wsa.example/api', { fetchFn })

    await transport.request({ method: 'getBridgeOrder', params: { id: 'o1' } })

    const [url] = (fetchFn as any).mock.calls[0]
    expect(url).toBe('https://wsa.example/api/bridge/orders/o1')
  })

  it('GETs /bridge/orders/{id}/audit', async () => {
    const fetchFn = makeFetchMock({ ok: true, body: { data: {} } })
    const transport = httpBridge('https://wsa.example/api', { fetchFn })

    await transport.request({ method: 'getBridgeOrderAudit', params: { id: 'o1' } })

    const [url] = (fetchFn as any).mock.calls[0]
    expect(url).toBe('https://wsa.example/api/bridge/orders/o1/audit')
  })

  it('URL-encodes order ids with special characters', async () => {
    const fetchFn = makeFetchMock({ ok: true, body: { data: {} } })
    const transport = httpBridge('https://wsa.example/api', { fetchFn })

    await transport.request({ method: 'getBridgeOrder', params: { id: 'a/b c' } })

    const [url] = (fetchFn as any).mock.calls[0]
    expect(url).toBe('https://wsa.example/api/bridge/orders/a%2Fb%20c')
  })

  it('throws TransportError on non-2xx', async () => {
    const fetchFn = makeFetchMock({ ok: false, status: 500, body: { error: 'boom' } })
    const transport = httpBridge('https://wsa.example/api', { fetchFn })

    await expect(transport.request({ method: 'getBridgeOrder', params: { id: 'o1' } }))
      .rejects.toThrow(/HTTP 500/)
  })

  it('throws on unknown method', async () => {
    const transport = httpBridge('https://wsa.example/api', { fetchFn: vi.fn() })
    await expect(transport.request({ method: 'doesNotExist' as any })).rejects.toThrow()
  })
})
