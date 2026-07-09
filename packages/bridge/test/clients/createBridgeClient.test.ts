import { describe, it, expect, vi } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { httpBridge } from '../../src/transports/httpBridge.js'
import type { WalletClient } from '@provablehq/veil-core'

describe('createBridgeClient', () => {
  it('exposes a request function from the transport', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
    })
    expect(typeof client.request).toBe('function')
  })

  it('has the bridge key by default', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
    })
    expect(client.key).toBe('bridge')
  })

  it('has Bridge Client name by default', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
    })
    expect(client.name).toBe('Bridge Client')
  })

  it('respects custom key and name', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
      key: 'custom-bridge',
      name: 'My Bridge',
    })
    expect(client.key).toBe('custom-bridge')
    expect(client.name).toBe('My Bridge')
  })

  it('is extendable like other Veil clients', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
    })
    const extended = client.extend(() => ({ hello: () => 'world' }))
    expect(extended.hello()).toBe('world')
  })
})

describe('createBridgeClient bound actions', () => {
  it('exposes getFlags, getQuotes, createOrder, getOrder, getOrderAudit, waitForOrder', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
    })
    expect(typeof client.getFlags).toBe('function')
    expect(typeof client.getQuotes).toBe('function')
    expect(typeof client.createOrder).toBe('function')
    expect(typeof client.getOrder).toBe('function')
    expect(typeof client.getOrderAudit).toBe('function')
    expect(typeof client.waitForOrder).toBe('function')
  })

  it('swap uses the construction-time wallet without per-call wiring', async () => {
    // Full happy-path responses over the transport so bridge.swap runs
    // quote → order → deposit with only the route in its params.
    const fetchFn = vi.fn(async (url: string) => {
      const body = String(url).includes('/quotes')
        ? {
            data: [{
              provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
              quoteId: 'q1',
              srcChain: 'ALEO', destChain: 'SOLANA',
              srcAsset: 'ALEO_MAINNET', destAsset: 'SOL_SOLANA',
              amountIn: '1.5', amountOut: '0.05',
            }],
            meta: { count: 1, quoteRequestId: 'req-1' },
          }
        : { data: { orderId: 'o1', depositAddress: 'aleo1deposit', depositAmount: '1.5', depositChain: 'ALEO' } }
      return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }
    })
    const wallet = {
      account: { type: 'rpc', address: 'aleo1sender', sign: vi.fn() },
      request: vi.fn().mockResolvedValue('at1deadbeef'),
    } as unknown as WalletClient

    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
      wallet,
    })

    const result = await client.swap({
      from: { asset: 'ALEO_MAINNET', amount: '1.5' },
      to: { chain: 'SOLANA', asset: 'SOL_SOLANA', address: '8xJ...' },
      poll: false,
    })

    expect(result.depositTxId).toBe('at1deadbeef')
    expect((wallet as unknown as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalled()
  })

  it('swap without a wallet anywhere throws with guidance', async () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
    })
    await expect(
      client.swap({
        from: { asset: 'ALEO_MAINNET', amount: '1' },
        to: { chain: 'SOLANA', asset: 'SOL_SOLANA', address: '8xJ...' },
      }),
    ).rejects.toThrow(/createBridgeClient\(\{ wallet \}\)/)
  })
})
