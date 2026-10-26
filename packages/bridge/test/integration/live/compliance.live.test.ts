import { describe, expect, it, vi } from 'vitest'
import { createPublicClient, http } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { createAleoClient, createBridgeClient, DEFAULT_BRIDGE_REGISTRY, type AleoWalletClient } from '../../../src/index.js'
import { prepare } from '../../../src/actions/prepare.js'

// Read-only chain access with a public test-vector address. The executor only
// captures inputs; no private key, transaction proving, or broadcast is used.
describe.runIf(process.env.VEIL_INTEGRATION === '1')('live Bridge compliance witnesses', () => {
  it.each(['testnet', 'mainnet'] as const)('resolves unshield and burn witnesses against the %s root', async (network) => {
    const sdk = await loadNetwork(network)
    const publicClient = createPublicClient({ transport: http('https://edge.provable.com/api/v2', { network }) })
    const address = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
    const chain = network === 'testnet' ? 'aleo-testnet' : 'aleo'
    const programId = network === 'testnet' ? 'test_usdcx_freezelist.aleo' : 'usdcx_freezelist.aleo'
    const root = await publicClient.readContract({ programId, mapping: 'freeze_list_root', key: '1u8' })
    const tree = await publicClient.getComplianceFreezeList({ programId })
    const expected = await sdk.generateFreezelistProof({ address, tree, root: root! })
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>().mockResolvedValue('at1read-only')
    const walletClient: AleoWalletClient = {
      account: { type: 'local', address } as AleoWalletClient['account'],
      proving: { mode: 'local', generateFreezelistProof: sdk.generateFreezelistProof },
      executeTransaction,
    }
    const bridge = createBridgeClient({ clients: { [chain]: createAleoClient({ publicClient, account: walletClient }) } })
    const asset = { chain, asset: 'usdcx' }
    const record = `{ owner: ${address}.private, amount: 2500000u128.private }`
    await bridge.unshield({ asset, amount: '2.5', record, recipient: address })
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: asset, destination: { chain: network === 'testnet' ? 'sepolia' : 'ethereum', asset: 'usdc' },
      amount: '2.5', recipient: '0x0000000000000000000000000000000000000001',
    })
    await bridge.execute({ plan, userRecord: record })
    expect(executeTransaction.mock.calls[0]?.[0].inputs?.[3]).toBe(expected)
    expect(executeTransaction.mock.calls[1]?.[0].inputs?.[4]).toBe(expected)
  }, 30_000)
})
