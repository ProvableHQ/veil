import { describe, expect, it } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { createBridgeMcpServer } from '../../src/mcp/index.js'

describe('createBridgeMcpServer', () => {
  it('serves the protocol bridge tool set', async () => {
    const server = createBridgeMcpServer(createBridgeClient())
    expect(server.tools.map((tool) => tool.name)).toEqual([
      'bridge_list_assets',
      'bridge_list_routes',
      'bridge_prepare_transfer',
    ])
    const routes = await server.handleToolCall('bridge_list_routes', { protocol: 'xreserve' })
    expect(Array.isArray(routes)).toBe(true)
  })
})
