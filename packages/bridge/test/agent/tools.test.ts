import { describe, it, expect, vi } from 'vitest'
import { createBridgeAgentTools } from '../../src/agent/tools.js'
import type { BridgeClient } from '../../src/clients/createBridgeClient.js'

function fakeClient() {
  return {
    getFlags: vi.fn().mockResolvedValue({ near_supports_pub_priv_swaps: true }),
    getQuotes: vi.fn().mockResolvedValue({ quotes: [], meta: { count: 0, quoteRequestId: 'r' } }),
    createOrder: vi.fn().mockResolvedValue({
      orderId: 'o1',
      depositAddress: 'a',
      depositAmount: '1',
      depositChain: 'aleo',
      instructions: { type: 'ONCHAIN_DEPOSIT', address: 'a', amount: '1', chain: 'aleo' },
    }),
    getOrder: vi.fn().mockResolvedValue({
      orderId: 'o1',
      provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
      status: 'WAITING',
      timeline: [],
      createdAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T00:00:00Z',
    }),
    getOrderAudit: vi.fn().mockResolvedValue({
      orderId: 'o1',
      provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
      status: 'COMPLETED',
      timeline: [],
      createdAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T00:00:00Z',
      steps: [],
      providerEvents: [],
    }),
    waitForOrder: vi.fn().mockResolvedValue({
      orderId: 'o1',
      provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
      status: 'COMPLETED',
      timeline: [],
      createdAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T00:00:00Z',
    }),
    swap: vi.fn().mockResolvedValue({
      quoteRequestId: 'r',
      orderId: 'o1',
      depositTxId: 'at1tx',
    }),
  } as unknown as BridgeClient
}

describe('createBridgeAgentTools', () => {
  it('returns one core-shaped AgentTool per action with non-empty descriptions', () => {
    const tools = createBridgeAgentTools(fakeClient())
    const names = tools.map((t) => t.schema.name)
    expect(names).toEqual([
      'bridge_get_flags',
      'bridge_get_quotes',
      'bridge_create_order',
      'bridge_get_order',
      'bridge_get_order_audit',
      'bridge_wait_for_order',
      'bridge_swap',
    ])
    for (const tool of tools) {
      expect(tool.schema.description.length).toBeGreaterThan(0)
      expect(tool.schema.inputSchema.type).toBe('object')
      expect(typeof tool.handler).toBe('function')
    }
  })

  it('bridge_get_quotes schema requires the OpenAPI required fields', () => {
    const tools = createBridgeAgentTools(fakeClient())
    const tool = tools.find((t) => t.schema.name === 'bridge_get_quotes')!
    expect(tool.schema.inputSchema.required).toEqual(['srcChain', 'srcAsset', 'destChain', 'destAsset', 'amountIn'])
  })

  it('bridge_create_order schema requires the OpenAPI CreateBridgeOrderRequest required fields', () => {
    const tools = createBridgeAgentTools(fakeClient())
    const tool = tools.find((t) => t.schema.name === 'bridge_create_order')!
    expect(tool.schema.inputSchema.required).toEqual([
      'providerId',
      'srcChain',
      'srcAsset',
      'destChain',
      'destAsset',
      'amountIn',
      'walletAddress',
      'quoteId',
    ])
  })

  it('bridge_get_flags handler proxies to client.getFlags', async () => {
    const client = fakeClient()
    const tools = createBridgeAgentTools(client)
    const tool = tools.find((t) => t.schema.name === 'bridge_get_flags')!
    const result = await tool.handler({})
    expect(client.getFlags as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled()
    expect((result as { near_supports_pub_priv_swaps: boolean }).near_supports_pub_priv_swaps).toBe(true)
  })

  it('bridge_get_quotes handler proxies to client.getQuotes', async () => {
    const client = fakeClient()
    const tools = createBridgeAgentTools(client)
    const tool = tools.find((t) => t.schema.name === 'bridge_get_quotes')!
    const result = await tool.handler({
      srcChain: 'ALEO',
      srcAsset: 'ALEO_MAINNET',
      destChain: 'SOLANA',
      destAsset: 'SOL_SOLANA',
      amountIn: '1',
    })
    expect(client.getQuotes as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled()
    expect((result as { meta: { quoteRequestId: string } }).meta.quoteRequestId).toBe('r')
  })

  it('bridge_swap handler proxies to client.swap', async () => {
    const client = fakeClient()
    const tools = createBridgeAgentTools(client)
    const tool = tools.find((t) => t.schema.name === 'bridge_swap')!
    const result = await tool.handler({
      from: { asset: 'ALEO', amount: '1' },
      to: { chain: 'solana', asset: 'SOL', address: '8xJ...' },
    })
    expect(client.swap as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled()
    expect((result as { orderId: string }).orderId).toBe('o1')
  })
})
