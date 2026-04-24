import { describe, it, expect, vi } from 'vitest'
import { getOriginalDeploymentTransaction } from '../../../src/actions/public/getOriginalDeploymentTransaction.js'

describe('getOriginalDeploymentTransaction', () => {
  it('returns the original (pre-amendment) deployment transaction ID', async () => {
    const txId = 'at1original'
    const client = { request: vi.fn().mockResolvedValue(txId) } as any
    const result = await getOriginalDeploymentTransaction(client, { programId: 'token.aleo', edition: 4 })
    expect(result).toBe(txId)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getOriginalDeploymentTransaction',
      params: { programId: 'token.aleo', edition: 4 },
    })
  })
})
