import { describe, expect, it } from 'vitest'
import { createBridgeAgentTools } from '../../src/agent/tools.js'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'

describe('createBridgeAgentTools', () => {
  it('exposes only discovery and non-fund-moving planning tools', () => {
    const tools = createBridgeAgentTools(createBridgeClient())
    expect(tools.map((tool) => tool.schema.name)).toEqual([
      'bridge_list_assets',
      'bridge_list_routes',
      'bridge_prepare_transfer',
    ])
  })

  it('prepares a transfer through the bound client', async () => {
    const tool = createBridgeAgentTools(createBridgeClient())
      .find((entry) => entry.schema.name === 'bridge_prepare_transfer')!
    const plan = await tool.handler({
      routeId: 'xreserve:aleo/usdcx->ethereum/usdc',
      amount: '1',
      recipient: '0x0000000000000000000000000000000000000001',
    }) as { protocol: string }
    expect(plan.protocol).toBe('xreserve')
  })
})
