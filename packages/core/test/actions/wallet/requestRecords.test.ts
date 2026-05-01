import { describe, it, expect, vi } from 'vitest'
import { requestRecords } from '../../../src/actions/wallet/requestRecords.js'
import { AccountNotFoundError } from '../../../src/errors/errors.js'

describe('requestRecords', () => {
  it('RPC account delegates to transport', async () => {
    const mockRecords = [{ programName: 'token.aleo', tag: '123', spent: false, recordPlaintext: '{}' }]
    const request = vi.fn().mockResolvedValue(mockRecords)
    const client = {
      account: { type: 'rpc', address: 'aleo1abc' },
      recordProvider: undefined,
      request,
    } as any

    const result = await requestRecords(client, { program: 'token.aleo' })
    expect(result).toEqual(mockRecords)
    expect(request).toHaveBeenCalledWith({
      method: 'requestRecords',
      params: { program: 'token.aleo', includePlaintext: true, statusFilter: 'all' },
    })
  })

  it('RPC account ignores recordProvider even if present', async () => {
    const mockRecords = [{ programName: 'token.aleo', tag: '123', spent: false, recordPlaintext: '{}' }]
    const request = vi.fn().mockResolvedValue(mockRecords)
    const recordProvider = { requestRecords: vi.fn() }
    const client = {
      account: { type: 'rpc', address: 'aleo1abc' },
      recordProvider,
      request,
    } as any

    await requestRecords(client, { program: 'token.aleo' })
    expect(request).toHaveBeenCalled()
    expect(recordProvider.requestRecords).not.toHaveBeenCalled()
  })

  it('local account uses recordProvider', async () => {
    const mockRecords = [{ programName: 'token.aleo', tag: '456', spent: false, recordPlaintext: '{}' }]
    const recordProvider = {
      requestRecords: vi.fn().mockResolvedValue(mockRecords),
      setAccount: vi.fn(),
    }
    const client = {
      account: { type: 'local', address: 'aleo1abc', viewKey: 'AViewKey1abc' },
      recordProvider,
      request: vi.fn(),
    } as any

    const result = await requestRecords(client, { program: 'token.aleo' })
    expect(result).toEqual(mockRecords)
    expect(recordProvider.requestRecords).toHaveBeenCalledWith({ program: 'token.aleo' })
    expect(client.request).not.toHaveBeenCalled()
  })

  it('local account throws without recordProvider', async () => {
    const client = {
      account: { type: 'local', address: 'aleo1abc', viewKey: 'AViewKey1abc' },
      recordProvider: undefined,
      request: vi.fn(),
    } as any

    await expect(requestRecords(client, { program: 'token.aleo' }))
      .rejects.toThrow('Local account requires a recordProvider')
  })

  it('throws without account', async () => {
    const client = { account: undefined, request: vi.fn() } as any
    await expect(requestRecords(client, { program: 'token.aleo' })).rejects.toThrow(AccountNotFoundError)
  })
})
