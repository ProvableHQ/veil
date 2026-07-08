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

describe('test client advanceBlock action', () => {
  it('issues one block-creation request per block', async () => {
    // The devnode mines exactly one block per POST and ignores the body count,
    // so the action must issue count separate requests.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })
    const client = createTestClient({
      transport: http('http://127.0.0.1:3030', { fetchFn: mockFetch, network: 'testnet' }),
    })

    await client.advanceBlock({ count: 3 })

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3030/testnet/block/create',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('defaults to a single block', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })
    const client = createTestClient({
      transport: http('http://127.0.0.1:3030', { fetchFn: mockFetch, network: 'testnet' }),
    })

    await client.advanceBlock()

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('test client shutdown action', () => {
  it('resolves when the devnode acknowledges with an empty body', async () => {
    // The devnode answers shutdown with a 2xx empty body, which the JSON
    // transport surfaces as a SyntaxError; the action treats that as success.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    })
    const client = createTestClient({
      transport: http('http://127.0.0.1:3030', { fetchFn: mockFetch, network: 'testnet' }),
    })

    await expect(client.shutdown()).resolves.toBeUndefined()
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3030/testnet/shutdown',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('propagates a genuine transport failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('boom'),
    })
    const client = createTestClient({
      transport: http('http://127.0.0.1:3030', { fetchFn: mockFetch, network: 'testnet' }),
    })

    await expect(client.shutdown()).rejects.toThrow(/500/)
  })
})
