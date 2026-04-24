import { describe, it, expect, vi } from 'vitest'
import { getProgramMetricsByRange } from '../../../src/actions/public/getProgramMetricsByRange.js'

describe('getProgramMetricsByRange', () => {
  it('returns program metrics over the given day range', async () => {
    const payload = [
      { day: '2026-04-21', calls: 12 },
      { day: '2026-04-22', calls: 18 },
    ]
    const client = { request: vi.fn().mockResolvedValue(payload) } as any
    const result = await getProgramMetricsByRange(client, { programId: 'token.aleo', days: 30 })
    expect(result).toEqual(payload)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getProgramMetricsByRange',
      params: { programId: 'token.aleo', days: 30 },
    })
  })
})
