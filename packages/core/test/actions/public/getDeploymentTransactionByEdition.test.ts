import { describe, it, expect, vi } from 'vitest'
import { getDeploymentTransactionByEdition } from '../../../src/actions/public/getDeploymentTransactionByEdition.js'

describe('getDeploymentTransactionByEdition', () => {
  it('returns transaction ID for a program edition', async () => {
    const txId = 'at1deployedition'
    const client = { request: vi.fn().mockResolvedValue(txId) } as any
    const result = await getDeploymentTransactionByEdition(client, { programId: 'token.aleo', edition: 4 })
    expect(result).toBe(txId)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getDeploymentTransactionByEdition',
      params: { programId: 'token.aleo', edition: 4 },
    })
  })
})
