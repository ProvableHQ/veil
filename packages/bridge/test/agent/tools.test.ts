import { describe, expect, it, vi } from 'vitest'
import type { BridgeClient } from '../../src/clients/createBridgeClient.js'
import { createBridgeAgentTools } from '../../src/agent/tools.js'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'

describe('createBridgeAgentTools', () => {
  it('exposes only discovery and non-fund-moving planning tools', () => {
    const tools = createBridgeAgentTools(createBridgeClient())
    expect(tools.map((tool) => tool.schema.name)).toEqual([
      'bridge_list_assets',
      'bridge_list_routes',
      'bridge_quote_transfer',
    ])
  })

  it('quotes a transfer through the bound client', async () => {
    const tool = createBridgeAgentTools(createBridgeClient())
      .find((entry) => entry.schema.name === 'bridge_quote_transfer')!
    const quote = await tool.handler({
      source: { chain: 'aleo', asset: 'usdcx' },
      destination: { chain: 'ethereum', asset: 'usdc' },
      amount: '2.000001',
      recipient: '0x0000000000000000000000000000000000000001',
    }) as { plan: { protocol: string } }
    expect(quote.plan.protocol).toBe('xreserve')
  })

  it('returns JSON-safe quote values for agent and MCP transports', async () => {
    const client = {
      environment: 'mainnet',
      registry: createBridgeClient().registry,
      quote: vi.fn(async () => ({
        kind: 'evm-xreserve',
        amountAtomic: 2_000_000n,
        fees: [{ amountAtomic: 100_000n }],
      })),
    } as unknown as BridgeClient
    const tool = createBridgeAgentTools(client)
      .find((entry) => entry.schema.name === 'bridge_quote_transfer')!

    const result = await tool.handler({}) as {
      amountAtomic: string
      fees: { amountAtomic: string }[]
    }

    expect(result).toEqual({
      kind: 'evm-xreserve',
      amountAtomic: '2000000',
      fees: [{ amountAtomic: '100000' }],
    })
    expect(() => JSON.stringify(result)).not.toThrow()
  })
})
