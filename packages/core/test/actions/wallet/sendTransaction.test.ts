import { describe, it, expect, vi } from 'vitest'
import { sendTransaction } from '../../../src/actions/wallet/sendTransaction.js'

describe('sendTransaction', () => {
  it('submits built transaction to transport', async () => {
    const request = vi.fn().mockResolvedValue('at1sent')
    const client = { request } as any

    const result = await sendTransaction(client, { transaction: '{"type":"execute"}' })
    expect(result).toBe('at1sent')
    expect(request).toHaveBeenCalledWith({
      method: 'sendTransaction',
      params: { transaction: '{"type":"execute"}' },
    })
  })
})
