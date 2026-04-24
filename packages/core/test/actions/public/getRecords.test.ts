import { describe, it, expect, vi } from 'vitest'
import { getRecords } from '../../../src/actions/public/getRecords.js'

describe('getRecords', () => {
  it('uses custom getRecords from records config', async () => {
    const mockRecords = [
      { owner: 'aleo1owner', data: {}, nonce: 'nonce1', programId: 'token.aleo', plaintext: '...' },
    ]
    const customGetRecords = vi.fn().mockResolvedValue(mockRecords)

    const client = {
      records: { getRecords: customGetRecords },
      request: vi.fn(),
    } as any

    const result = await getRecords(client, { programId: 'token.aleo' })

    expect(result).toEqual(mockRecords)
    expect(customGetRecords).toHaveBeenCalledWith({ programId: 'token.aleo' })
    expect(client.request).not.toHaveBeenCalled()
  })

  it('delegates to transport for network mode records config', async () => {
    const mockRecords = [
      { owner: 'aleo1owner', data: {}, nonce: 'nonce1', programId: 'token.aleo', plaintext: '...' },
    ]

    const client = {
      records: { mode: 'network', url: 'https://scanner.example.com' },
      request: vi.fn().mockResolvedValue(mockRecords),
    } as any

    const result = await getRecords(client, { programId: 'token.aleo' })

    expect(result).toEqual(mockRecords)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getRecords',
      params: { programId: 'token.aleo' },
    })
  })

  it('falls back to requestRecords via transport when no records config', async () => {
    const mockRecords = [{ owner: 'aleo1owner' }]

    const client = {
      records: undefined,
      request: vi.fn().mockResolvedValue(mockRecords),
    } as any

    const result = await getRecords(client, { programId: 'token.aleo' })

    expect(result).toEqual(mockRecords)
    expect(client.request).toHaveBeenCalledWith({
      method: 'requestRecords',
      params: { programId: 'token.aleo' },
    })
  })

  it('returns empty array when transport does not support records', async () => {
    const client = {
      records: undefined,
      request: vi.fn().mockRejectedValue(new Error('Unknown method')),
    } as any

    const result = await getRecords(client, { programId: 'token.aleo' })

    expect(result).toEqual([])
  })

  it('local mode falls back to requestRecords transport', async () => {
    const mockRecords = [{ owner: 'aleo1owner' }]

    const client = {
      records: { mode: 'local' },
      request: vi.fn().mockResolvedValue(mockRecords),
    } as any

    const result = await getRecords(client, { programId: 'token.aleo' })

    expect(result).toEqual(mockRecords)
    expect(client.request).toHaveBeenCalledWith({
      method: 'requestRecords',
      params: { programId: 'token.aleo' },
    })
  })
})
