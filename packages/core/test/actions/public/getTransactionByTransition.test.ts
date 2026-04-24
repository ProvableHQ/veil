import { describe, it, expect, vi } from 'vitest'
import { getTransactionByTransition } from '../../../src/actions/public/getTransactionByTransition.js'

describe('getTransactionByTransition', () => {
  it('composes findTransactionId + getTransaction and returns the full transaction', async () => {
    const txId = 'at1txidabc'
    const transitionId = 'au1transitionidxyz'
    const transaction = { type: 'execute', id: txId, fee: {} } as any

    const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === 'findTransactionId') return Promise.resolve(txId)
      if (method === 'getTransaction') return Promise.resolve(transaction)
      return Promise.reject(new Error(`unexpected method ${method}`))
    })

    const client = { request } as any

    const result = await getTransactionByTransition(client, { transitionId })

    expect(result).toEqual(transaction)
    expect(request).toHaveBeenNthCalledWith(1, {
      method: 'findTransactionId',
      params: { transitionId },
    })
    expect(request).toHaveBeenNthCalledWith(2, {
      method: 'getTransaction',
      params: { id: txId },
    })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('propagates errors from the findTransactionId lookup', async () => {
    const request = vi.fn().mockRejectedValue(new Error('transition not found'))
    const client = { request } as any

    await expect(
      getTransactionByTransition(client, { transitionId: 'au1missing' }),
    ).rejects.toThrow('transition not found')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('propagates errors from the getTransaction fetch', async () => {
    const request = vi.fn().mockImplementation(({ method }: { method: string }) => {
      if (method === 'findTransactionId') return Promise.resolve('at1txid')
      return Promise.reject(new Error('transaction not found'))
    })
    const client = { request } as any

    await expect(
      getTransactionByTransition(client, { transitionId: 'au1abc' }),
    ).rejects.toThrow('transaction not found')
    expect(request).toHaveBeenCalledTimes(2)
  })
})
