import { describe, it, expect, vi } from 'vitest'
import { requestRecords } from '../../../src/actions/wallet/requestRecords.js'
import { createWalletClient } from '../../../src/clients/createWalletClient.js'
import { AccountNotFoundError } from '../../../src/errors/errors.js'

describe('requestRecords', () => {
  it('RPC account delegates to transport and returns the result untouched', async () => {
    // Deliberately out of block order: without a filter the wallet's result must
    // come back verbatim, neither reordered nor trimmed.
    const mockRecords = [
      { programName: 'token.aleo', tag: '123', blockHeight: 30, spent: false, recordPlaintext: '{}' },
      { programName: 'token.aleo', tag: '456', blockHeight: 10, spent: false, recordPlaintext: '{}' },
    ]
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

  it('RPC account throws when program is omitted', async () => {
    // The wallet-adapter protocol scopes a record request to one program and
    // has no all-programs form, so this cannot be forwarded.
    const request = vi.fn()
    const client = {
      account: { type: 'rpc', address: 'aleo1abc' },
      recordProvider: undefined,
      request,
    } as any

    await expect(requestRecords(client, {})).rejects.toThrow(
      'requestRecords requires a program for a wallet (RPC) account',
    )
    expect(request).not.toHaveBeenCalled()
  })

  it('local account scans every program when program is omitted', async () => {
    const recordProvider = {
      requestRecords: vi.fn().mockResolvedValue([]),
      setAccount: vi.fn(),
    }
    const client = {
      account: { type: 'local', address: 'aleo1abc', viewKey: 'AViewKey1abc' },
      recordProvider,
      request: vi.fn(),
    } as any

    await requestRecords(client, { statusFilter: 'unspent' })
    expect(recordProvider.requestRecords).toHaveBeenCalledWith({ statusFilter: 'unspent' })
  })

  it('local account forwards the filter to the provider untouched', async () => {
    // The provider pushes the bounds to the service; the action must not
    // pre-apply them or the service would filter an already-filtered set.
    const recordProvider = {
      requestRecords: vi.fn().mockResolvedValue([]),
      setAccount: vi.fn(),
    }
    const client = {
      account: { type: 'local', address: 'aleo1abc', viewKey: 'AViewKey1abc' },
      recordProvider,
      request: vi.fn(),
    } as any

    const params = { program: 'token.aleo', filter: { records: ['Card'], resultsPerPage: 5 } }
    await requestRecords(client, params)
    expect(recordProvider.requestRecords).toHaveBeenCalledWith(params)
  })

  it('RPC account applies the filter to what the wallet returned', async () => {
    // The wallet cannot forward row filters, so the same bounds are applied
    // locally — a caller sees identical results on either path.
    const walletRecords = [
      { programName: 'token.aleo', tag: 't1', recordName: 'Card', blockHeight: 10, commitment: 'c1' },
      { programName: 'token.aleo', tag: 't2', recordName: 'Coupon', blockHeight: 20, commitment: 'c2' },
      { programName: 'token.aleo', tag: 't3', recordName: 'Card', blockHeight: 30, commitment: 'c3' },
    ]
    const request = vi.fn().mockResolvedValue(walletRecords)
    const client = {
      account: { type: 'rpc', address: 'aleo1abc' },
      recordProvider: undefined,
      request,
    } as any

    const result = await requestRecords(client, {
      program: 'token.aleo',
      filter: { records: ['Card'], start: 20 },
    })

    expect(result.map((r: any) => r.commitment)).toEqual(['c3'])
    // The filter is not forwarded — the adapter has no parameter for it.
    expect(request).toHaveBeenCalledWith({
      method: 'requestRecords',
      params: { program: 'token.aleo', includePlaintext: true, statusFilter: 'all' },
    })
  })

  it('RPC account does not re-test the program the request already carried', async () => {
    // The wallet scoped the scan to the requested program, so re-testing it
    // client-side could only drop records. A wallet that spells the id
    // differently from the caller would otherwise return an empty result with
    // no error — the filter must still apply its other bounds.
    const walletRecords = [
      { programName: 'token.aleo/v2', tag: 't1', recordName: 'Card', commitment: 'c1' },
      { programName: 'token.aleo/v2', tag: 't2', recordName: 'Coupon', commitment: 'c2' },
    ]
    const client = {
      account: { type: 'rpc', address: 'aleo1abc' },
      recordProvider: undefined,
      request: vi.fn().mockResolvedValue(walletRecords),
    } as any

    const result = await requestRecords(client, {
      program: 'token.aleo',
      filter: { records: ['Card'] },
    })

    expect(result.map((r: any) => r.commitment)).toEqual(['c1'])
  })

  it('RPC account pages the wallet result set', async () => {
    const walletRecords = Array.from({ length: 5 }, (_, i) => ({
      programName: 'token.aleo',
      tag: `t${i}`,
      blockHeight: i,
      commitment: `c${i}`,
    }))
    const client = {
      account: { type: 'rpc', address: 'aleo1abc' },
      recordProvider: undefined,
      request: vi.fn().mockResolvedValue(walletRecords),
    } as any

    const page1 = await requestRecords(client, {
      program: 'token.aleo',
      filter: { resultsPerPage: 2, page: 1 },
    })
    expect(page1.map((r: any) => r.commitment)).toEqual(['c2', 'c3'])
  })

  it('a provider passed to createWalletClient reaches walletClient.requestRecords', async () => {
    // Regression: the wallet actions close over the pre-extension base
    // client, so the provider must be attached before extend() — a
    // post-extension property is invisible to the action's lookup.
    const mockRecords = [{ programName: 'token.aleo', tag: '789', spent: false, recordPlaintext: '{}' }]
    const recordProvider = {
      setAccount: vi.fn(),
      requestRecords: vi.fn().mockResolvedValue(mockRecords),
    }
    const walletClient = createWalletClient({
      account: {
        type: 'local',
        source: 'privateKey',
        address: 'aleo1abc',
        privateKey: 'APrivateKey1abc',
        viewKey: 'AViewKey1abc',
        sign: async (bytes: Uint8Array) => bytes,
        signMessage: async (bytes: Uint8Array) => bytes,
      } as any,
      transport: { config: { key: 't', name: 't', type: 'mock', request: vi.fn() }, request: vi.fn() } as any,
      recordProvider,
    })

    const result = await walletClient.requestRecords({ program: 'token.aleo' })
    expect(result).toEqual(mockRecords)
    expect(recordProvider.requestRecords).toHaveBeenCalledWith({ program: 'token.aleo' })
  })
})
