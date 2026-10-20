import { describe, expect, it } from 'vitest'
import { createClient, createPublicClient, http, type Client } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { resolveActionProofs, ammProofContext } from '../../src/utils/resolveProofs.js'

// Read-only: uses a public test-vector address; no private key or transaction.
describe.runIf(process.env.VEIL_INTEGRATION === '1')('live compliance trees', () => {
  for (const network of ['testnet', 'mainnet'] as const) it(`validates and caches the ${network} witness against the current root`, async () => {
    const sdk = await loadNetwork(network)
    const publicClient = createPublicClient({ transport: http('https://edge.provable.com/api/v2', { network }) })
    const address = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
    const programId = network === 'testnet' ? 'shield_swap_freezelist.aleo' : 'usdcx_freezelist.aleo'
    const root = await publicClient.readContract({ programId, mapping: 'freeze_list_root', key: '1u8' })
    expect(root).toMatch(/^\d+field$/)
    const tree = await publicClient.getComplianceFreezeList({ programId })
    const expected = await sdk.generateFreezelistProof({ address, tree, root: root! })
    const client = createClient({
      transport: publicClient.transport,
      account: { type: 'local', address } as Client['account'],
      proving: { mode: 'local', generateFreezelistProof: sdk.generateFreezelistProof },
    })
    const config = { ammFreezelistProgram: programId }
    expect(await resolveActionProofs(client, undefined, [ammProofContext(address)], config)).toEqual([expected])
    expect(await resolveActionProofs(client, null, [ammProofContext(address)], config)).toEqual([expected])
  }, 30_000)
})
