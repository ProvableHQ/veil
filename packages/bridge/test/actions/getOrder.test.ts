import { describe, it, expect, vi } from 'vitest'
import { getOrder } from '../../src/actions/getOrder.js'
import type { Client } from '@veil/core'

function makeClient(response: unknown): Client {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as Client
}

function makeStatus(over: Partial<unknown> = {}): unknown {
  return {
    orderId: 'o1',
    provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
    status: 'WAITING',
    timeline: [],
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
    ...(over as object),
  }
}

describe('getOrder', () => {
  it('returns BridgeOrderStatusDto', async () => {
    const client = makeClient({ data: makeStatus() })

    const result = await getOrder(client, { id: 'o1' })

    expect(result.orderId).toBe('o1')
    expect(result.status).toBe('WAITING')
    expect(result.timeline).toEqual([])
    expect((client.request as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      method: 'getBridgeOrder',
      params: { id: 'o1' },
    })
  })

  it('surfaces final status when present', async () => {
    const client = makeClient({
      data: makeStatus({
        status: 'COMPLETED',
        finalStatus: { key: 'COMPLETED', status: 'COMPLETED' },
      }),
    })

    const result = await getOrder(client, { id: 'o1' })

    expect(result.status).toBe('COMPLETED')
    expect(result.finalStatus?.key).toBe('COMPLETED')
  })
})
