import { describe, it, expect, vi } from 'vitest'
import { fallback } from '../../src/transports/fallback.js'
import { custom } from '../../src/transports/custom.js'

describe('fallback transport', () => {
  it('creates a transport with type fallback', () => {
    const t1 = custom({ request: vi.fn() })
    const t2 = custom({ request: vi.fn() })
    const transport = fallback([t1, t2])
    expect(transport.config.type).toBe('fallback')
  })

  it('uses first transport when it succeeds', async () => {
    const t1 = custom({ request: vi.fn().mockResolvedValue(1) })
    const t2 = custom({ request: vi.fn().mockResolvedValue(2) })
    const transport = fallback([t1, t2])

    const result = await transport.request({ method: 'getLatestHeight' })
    expect(result).toBe(1)
  })

  it('falls back to second transport when first fails', async () => {
    const t1 = custom({ request: vi.fn().mockRejectedValue(new Error('down')) })
    const t2 = custom({ request: vi.fn().mockResolvedValue(2) })
    const transport = fallback([t1, t2])

    const result = await transport.request({ method: 'getLatestHeight' })
    expect(result).toBe(2)
  })

  it('throws when all transports fail', async () => {
    const t1 = custom({ request: vi.fn().mockRejectedValue(new Error('down1')) })
    const t2 = custom({ request: vi.fn().mockRejectedValue(new Error('down2')) })
    const transport = fallback([t1, t2])

    await expect(transport.request({ method: 'getLatestHeight' })).rejects.toThrow()
  })
})
