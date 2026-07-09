import { describe, it, expect, vi } from 'vitest'
import { createBridgeMcpServer } from '../../src/mcp/index.js'
import { createBridgeAgentTools } from '../../src/agent/tools.js'
import { toMcpServer } from '@provablehq/veil-core/mcp'
import type { BridgeClient } from '../../src/clients/createBridgeClient.js'

function fakeClient() {
  return {
    getAssets: vi.fn().mockResolvedValue([]),
    getProviders: vi.fn().mockResolvedValue([]),
    getRoutes: vi.fn().mockResolvedValue([]),
    getFlags: vi.fn().mockResolvedValue({ near_supports_pub_priv_swaps: false }),
    getQuotes: vi.fn().mockResolvedValue({ quotes: [], meta: { count: 0, quoteRequestId: 'r' } }),
  } as unknown as BridgeClient
}

describe('createBridgeMcpServer', () => {
  it('serves every bridge tool and dispatches by name', async () => {
    const server = createBridgeMcpServer(fakeClient())
    expect(server.tools.map((t) => t.name)).toContain('bridge_get_flags')
    expect(server.tools).toHaveLength(10)

    const flags = await server.handleToolCall('bridge_get_flags', {})
    expect((flags as { near_supports_pub_priv_swaps: boolean }).near_supports_pub_priv_swaps).toBe(false)
  })

  it('composes with other AgentTool arrays through core toMcpServer', async () => {
    const other = {
      schema: {
        name: 'other_ping',
        description: 'test tool from another package',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      handler: async () => 'pong',
    }
    const server = toMcpServer([...createBridgeAgentTools(fakeClient()), other])
    expect(server.tools).toHaveLength(11)
    expect(await server.handleToolCall('other_ping', {})).toBe('pong')
    const flags = await server.handleToolCall('bridge_get_flags', {})
    expect(flags).toBeDefined()
  })
})
