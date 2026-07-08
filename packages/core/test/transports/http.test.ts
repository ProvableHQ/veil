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
      'https://api.provable.com/v2/mainnet/block/height/latest',
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

  it('maps snapshot to POST /snapshot carrying the name', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'before-deploy', height: 42 }),
    })

    const transport = http('http://127.0.0.1:3030', { fetchFn: mockFetch, network: 'testnet' })
    const result = await transport.request({ method: 'snapshot', params: { name: 'before-deploy' } })

    expect(result).toEqual({ name: 'before-deploy', height: 42 })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3030/testnet/snapshot',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'before-deploy' }) }),
    )
  })

  it('maps snapshot without a name to an empty JSON body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'snapshot-42', height: 42 }),
    })

    const transport = http('http://127.0.0.1:3030', { fetchFn: mockFetch, network: 'testnet' })
    await transport.request({ method: 'snapshot' })

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3030/testnet/snapshot',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    )
  })

  it('maps listSnapshots to GET /snapshots', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(['snapshot-42', 'before-deploy']),
    })

    const transport = http('http://127.0.0.1:3030', { fetchFn: mockFetch, network: 'testnet' })
    const result = await transport.request({ method: 'listSnapshots' })

    expect(result).toEqual(['snapshot-42', 'before-deploy'])
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3030/testnet/snapshots',
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
