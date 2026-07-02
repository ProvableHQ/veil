import { describe, it, expect } from 'vitest'
import type { Client } from '@veil/core'
import type { ApiClient } from '../../src/api/client.js'
import { createShieldSwapMcpServer } from '../../src/mcp/index.js'

function fakeApi(): ApiClient {
  return { getPools: async (q: unknown) => ({ data: [q] }) } as unknown as ApiClient
}

describe('createShieldSwapMcpServer', () => {
  it('exposes the tool definitions and dispatches by name', async () => {
    const server = createShieldSwapMcpServer({ client: {} as Client, api: fakeApi() })

    // Tool list mirrors the agent tools (MCP shape: name/description/inputSchema).
    const names = server.tools.map((t) => t.name)
    expect(names).toContain('shield_swap_list_pools')
    for (const t of server.tools) {
      expect(t.description.length).toBeGreaterThan(0)
      expect(t.inputSchema).toMatchObject({ type: 'object' })
    }

    // Dispatch routes to the right handler.
    const res = (await server.handleToolCall('shield_swap_list_pools', { limit: 3 })) as { data: unknown[] }
    expect(res.data).toEqual([{ limit: 3, offset: undefined }])
  })

  it('throws on an unknown tool name', async () => {
    const server = createShieldSwapMcpServer({ api: fakeApi() })
    await expect(server.handleToolCall('nope', {})).rejects.toThrow(/Unknown tool: "nope"/)
  })
})
