import { expect, it, vi } from 'vitest'
import { createPublicClient, http } from '../../src/index.js'

it('reads the published compliance tree through the configured transport', async () => {
  const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ['0', '0', '123'] }) as Response)
  const client = createPublicClient({ transport: http('https://node.example/v2', { network: 'testnet', fetchFn }) })
  expect(await client.getComplianceFreezeList({ programId: 'custom_list.aleo' })).toEqual(['0', '0', '123'])
  expect(fetchFn).toHaveBeenCalledWith('https://node.example/v2/testnet/programs/custom_list.aleo/compliance/freeze-list', expect.objectContaining({ method: 'GET' }))
})
