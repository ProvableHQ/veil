import { describe, it, expect, vi } from 'vitest'
import { requestTransactionHistory } from '../../../src/actions/wallet/requestTransactionHistory.js'

describe('requestTransactionHistory', () => {
  it('calls client.request with requestTransactionHistory method', async () => {
    const mockHistory = [{ id: 'tx1' }, { id: 'tx2' }]
    const request = vi.fn().mockResolvedValue(mockHistory)
    const client = { request } as any

    await requestTransactionHistory(client, { program: 'test.aleo' })
    expect(request).toHaveBeenCalledWith({
      method: 'requestTransactionHistory',
      params: { program: 'test.aleo' },
    })
  })

  it('returns the result from the request', async () => {
    const mockHistory = [{ id: 'tx1' }, { id: 'tx2' }]
    const request = vi.fn().mockResolvedValue(mockHistory)
    const client = { request } as any

    const result = await requestTransactionHistory(client, { program: 'test.aleo' })
    expect(result).toEqual(mockHistory)
  })
})
