import { describe, it, expect, vi } from 'vitest'
import { requestTransactionHistory } from '../../../src/actions/wallet/requestTransactionHistory.js'
import { TransactionHistoryNotSupportedError } from '../../../src/errors/errors.js'

describe('requestTransactionHistory', () => {
  it('RPC account — delegates to wallet via transport', async () => {
    const mockHistory = { transactions: [{ transactionId: 'at1', id: 'tx1' }] }
    const request = vi.fn().mockResolvedValue(mockHistory)
    const client = {
      account: { type: 'rpc', address: 'aleo1abc' },
      request,
    } as any

    const result = await requestTransactionHistory(client, { program: 'test.aleo' })
    expect(result).toEqual(mockHistory)
    expect(request).toHaveBeenCalledWith({
      method: 'requestTransactionHistory',
      params: { program: 'test.aleo' },
    })
  })

  it('local account throws TransactionHistoryNotSupportedError', async () => {
    const client = {
      account: { type: 'local', address: 'aleo1abc' },
      request: vi.fn(),
    } as any

    await expect(
      requestTransactionHistory(client, { program: 'test.aleo' }),
    ).rejects.toThrow(TransactionHistoryNotSupportedError)
  })

  it('no account throws TransactionHistoryNotSupportedError', async () => {
    const client = { account: undefined, request: vi.fn() } as any

    await expect(
      requestTransactionHistory(client, { program: 'test.aleo' }),
    ).rejects.toThrow(TransactionHistoryNotSupportedError)
  })
})
