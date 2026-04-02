import { describe, it, expect, vi } from 'vitest'
import { getTransitionViewKeys } from '../../../src/actions/public/getTransitionViewKeys.js'

describe('getTransitionViewKeys', () => {
  it('delegates to transport with transaction ID', async () => {
    const mockKeys = ['atvk1abc', 'atvk1def']
    const client = {
      request: vi.fn().mockResolvedValue(mockKeys),
    } as any

    const result = await getTransitionViewKeys(client, { transactionId: 'at1abc' })
    expect(result).toEqual(mockKeys)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getTransitionViewKeys',
      params: { id: 'at1abc' },
    })
  })
})
