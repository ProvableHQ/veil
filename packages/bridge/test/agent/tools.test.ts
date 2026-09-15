import { describe, expect, it } from 'vitest'
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
})
