import { describe, it, expect, vi } from 'vitest'
import { getAmendmentDeploymentTransaction } from '../../../src/actions/public/getAmendmentDeploymentTransaction.js'

describe('getAmendmentDeploymentTransaction', () => {
  it('returns transaction ID for a specific amendment', async () => {
    const txId = 'at1amendment'
    const client = { request: vi.fn().mockResolvedValue(txId) } as any
    const result = await getAmendmentDeploymentTransaction(client, {
      programId: 'token.aleo',
      edition: 4,
      amendment: 2,
    })
    expect(result).toBe(txId)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getAmendmentDeploymentTransaction',
      params: { programId: 'token.aleo', edition: 4, amendment: 2 },
    })
  })

  it('returns null when the amendment does not exist', async () => {
    const client = { request: vi.fn().mockResolvedValue(null) } as any
    const result = await getAmendmentDeploymentTransaction(client, {
      programId: 'token.aleo',
      edition: 4,
      amendment: 99,
    })
    expect(result).toBeNull()
  })
})
