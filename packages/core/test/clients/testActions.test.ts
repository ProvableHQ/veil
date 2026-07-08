import { describe, it, expect, vi } from 'vitest'
import { createTestClient } from '../../src/clients/createTestClient.js'
import { http } from '../../src/transports/http.js'

describe('test client snapshot actions', () => {
  it('snapshot() posts to the devnode and returns the parsed result', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'before-deploy', height: 42 }),
    })
    const client = createTestClient({
      transport: http('http://127.0.0.1:3030', { fetchFn: mockFetch, network: 'testnet' }),
    })

    const result = await client.snapshot({ name: 'before-deploy' })

    expect(result).toEqual({ name: 'before-deploy', height: 42 })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3030/testnet/snapshot',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'before-deploy' }) }),
    )
  })

  it('listSnapshots() returns the snapshot names', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(['snapshot-42', 'before-deploy']),
    })
    const client = createTestClient({
      transport: http('http://127.0.0.1:3030', { fetchFn: mockFetch, network: 'testnet' }),
    })

    const result = await client.listSnapshots()

    expect(result).toEqual(['snapshot-42', 'before-deploy'])
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3030/testnet/snapshots',
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
