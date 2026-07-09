import { describe, it, expect, vi } from 'vitest'
import { getOrderAudit } from '../../src/actions/getOrderAudit.js'
import type { Client } from '@provablehq/veil-core'

function makeClient(response: unknown): Client {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as Client
}

describe('getOrderAudit', () => {
  it('returns BridgeOrderAuditDto', async () => {
    const client = makeClient({
      data: {
        orderId: 'o1',
        provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
        status: 'CONFIRMING',
        timeline: [],
        createdAt: '2026-05-18T00:00:00Z',
        updatedAt: '2026-05-18T00:00:00Z',
        steps: [{ key: 'ORDER_CREATED', status: 'COMPLETED' }],
        providerEvents: [{
          id: 'e1', providerCode: 'demo', observedAt: '2026-05-18T00:00:00Z',
          source: 'webhook', createdAt: '2026-05-18T00:00:00Z',
        }],
      },
    })

    const result = await getOrderAudit(client, { id: 'o1' })

    expect(result.orderId).toBe('o1')
    expect(result.steps).toHaveLength(1)
    expect(result.providerEvents).toHaveLength(1)
    expect((client.request as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      method: 'getBridgeOrderAudit',
      params: { id: 'o1' },
    })
  })
})
