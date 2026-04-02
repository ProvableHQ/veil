import { describe, it, expect, vi } from 'vitest'
import { http } from '../../src/transports/http.js'

describe('http transport', () => {
  it('creates a transport with type http', () => {
    const transport = http('https://api.provable.com/v2')
    expect(transport.config.type).toBe('http')
    expect(transport.config.key).toBe('http')
    expect(transport.config.name).toBe('HTTP Transport')
  })

  it('makes GET requests to aleo REST API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(100),
    })

    const transport = http('https://api.provable.com/v2', { fetchFn: mockFetch })
    const result = await transport.request({ method: 'getLatestHeight' })

    expect(result).toBe(100)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.provable.com/v2/mainnet/latest/height',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('makes GET requests with params encoded in URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ blockHash: 'ab1...' }),
    })

    const transport = http('https://api.provable.com/v2', { fetchFn: mockFetch })
    await transport.request({ method: 'getBlock', params: { height: 100 } })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.provable.com/v2/mainnet/block/100',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('throws TransportError on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    })

    const transport = http('https://api.provable.com/v2', { fetchFn: mockFetch })
    await expect(transport.request({ method: 'getLatestHeight' })).rejects.toThrow()
  })
})
