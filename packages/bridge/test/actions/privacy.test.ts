import { describe, expect, it, vi } from 'vitest'
import { shield } from '../../src/actions/shield.js'
import { unshield } from '../../src/actions/unshield.js'
import { createAleoClient } from '../../src/connections/aleo.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import type { AleoWalletClient } from '../../src/types/aleo.js'

function clients(executeTransaction: AleoWalletClient['executeTransaction']) {
  return {
    aleo: createAleoClient({
      publicClient: {} as Parameters<typeof createAleoClient>[0]['publicClient'],
      account: { executeTransaction },
    }),
  }
}

describe('Aleo asset privacy actions', () => {
  it('shields a decimal ARC-20 amount through the asset privacy program', async () => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()
      .mockResolvedValue('at1shield')

    await expect(shield(DEFAULT_BRIDGE_REGISTRY, clients(executeTransaction), {
      asset: { chain: 'aleo', asset: 'eth' },
      amount: '0.000000000000000001',
    })).resolves.toEqual({
      transactionId: 'at1shield',
      assetId: 'aleo/eth',
      amount: '0.000000000000000001',
      amountAtomic: 1n,
    })
    expect(executeTransaction).toHaveBeenCalledWith(expect.objectContaining({
      program: 'arc20_eth.aleo',
      function: 'shield',
      inputs: ['1u128'],
      privateFee: false,
    }))
  })

  it('unshields an ARC-20 record selected by its minimum amount', async () => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()
      .mockResolvedValue('at1unshield')

    await unshield(DEFAULT_BRIDGE_REGISTRY, clients(executeTransaction), {
      asset: { chain: 'aleo', asset: 'sol' },
      amount: '0.25',
    })

    expect(executeTransaction).toHaveBeenCalledWith(expect.objectContaining({
      program: 'arc20_sol.aleo',
      function: 'unshield',
      inputs: [
        {
          type: 'record',
          program: 'arc20_sol.aleo',
          recordname: 'Token',
          filters: { amount: { gte: '250000000u128' } },
        },
        '250000000u128',
      ],
    }))
  })

  it('shields USDCx to the active wallet address', async () => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()
      .mockResolvedValue('at1usdcxshield')

    await shield(DEFAULT_BRIDGE_REGISTRY, clients(executeTransaction), {
      asset: { chain: 'aleo', asset: 'usdcx' },
      amount: '2.5',
    })

    expect(executeTransaction).toHaveBeenCalledWith(expect.objectContaining({
      program: 'usdcx_stablecoin.aleo',
      function: 'transfer_public_to_private',
      inputs: [{ type: 'address', label: 'USDCx private recipient' }, '2500000u128'],
    }))
  })

  it('unshields USDCx with a wallet-selected record and the empty-tree proof', async () => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()
      .mockResolvedValue('at1usdcxunshield')

    await unshield(DEFAULT_BRIDGE_REGISTRY, clients(executeTransaction), {
      asset: { chain: 'aleo', asset: 'usdcx' },
      amount: '2.5',
    })

    const call = executeTransaction.mock.calls[0]![0]
    expect(call).toMatchObject({
      program: 'usdcx_stablecoin.aleo',
      function: 'transfer_private_to_public',
    })
    expect(call.inputs?.slice(0, 3)).toEqual([
      { type: 'address', label: 'USDCx public recipient' },
      '2500000u128',
      {
        type: 'record',
        program: 'usdcx_stablecoin.aleo',
        recordname: 'Token',
        filters: { amount: { gte: '2500000u128' } },
      },
    ])
    expect(call.inputs?.[3]).toContain('leaf_index: 1u32')
    expect(call.inputs?.[3]?.match(/0field/g)).toHaveLength(32)
  })

  it('accepts explicit USDCx recipient, record, and proof inputs', async () => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()
      .mockResolvedValue('at1custom')
    const record = { type: 'record' as const, program: 'usdcx_stablecoin.aleo', recordname: 'Token', uid: 'record-1' }

    await unshield(DEFAULT_BRIDGE_REGISTRY, clients(executeTransaction), {
      asset: { chain: 'aleo', asset: 'usdcx' },
      amount: '2.5',
      recipient: `aleo1${'a'.repeat(58)}`,
      record,
      merkleProof: '[custom-proof]',
      privateFee: true,
    })

    expect(executeTransaction).toHaveBeenCalledWith(expect.objectContaining({
      inputs: [`aleo1${'a'.repeat(58)}`, '2500000u128', record, '[custom-proof]'],
      privateFee: true,
    }))
  })

  it('rejects assets without a declared shielding capability before wallet submission', async () => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()

    await expect(shield(DEFAULT_BRIDGE_REGISTRY, clients(executeTransaction), {
      asset: { chain: 'aleo', asset: 'aleo' },
      amount: '1',
    })).rejects.toThrow(/does not support shielding/i)
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('describes unsupported unshielding as an unshield operation', async () => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()

    await expect(unshield(DEFAULT_BRIDGE_REGISTRY, clients(executeTransaction), {
      asset: { chain: 'aleo', asset: 'aleo' },
      amount: '1',
    })).rejects.toThrow(/does not support unshielding/i)
  })

  it('rejects a zero unshield amount with operation-specific guidance', async () => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()

    await expect(unshield(DEFAULT_BRIDGE_REGISTRY, clients(executeTransaction), {
      asset: { chain: 'aleo', asset: 'sol' },
      amount: '0',
    })).rejects.toThrow(/Unshielding amount must be greater than zero/)
  })
})
