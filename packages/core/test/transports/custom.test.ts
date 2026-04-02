import { describe, it, expect, vi } from 'vitest'
import { custom } from '../../src/transports/custom.js'

describe('custom transport', () => {
  it('creates a transport with type custom', () => {
    const requestFn = vi.fn()
    const transport = custom({ request: requestFn })
    expect(transport.config.type).toBe('custom')
  })

  it('delegates requests to the provided function', async () => {
    const requestFn = vi.fn().mockResolvedValue(42)
    const transport = custom({ request: requestFn })
    const result = await transport.request({ method: 'getLatestHeight' })

    expect(result).toBe(42)
    expect(requestFn).toHaveBeenCalledWith({ method: 'getLatestHeight' })
  })
})
