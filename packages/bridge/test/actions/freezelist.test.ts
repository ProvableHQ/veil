import { describe, expect, it, vi } from 'vitest'
import { freezelistProofRequest, type FreezelistProofInput } from '@provablehq/veil-core'
import { unshield } from '../../src/actions/unshield.js'
import { prepare } from '../../src/actions/prepare.js'
import { execute } from '../../src/actions/execute.js'
import { buildXReserveBurnCall } from '../../src/builders/buildXReserveBurnCall.js'
import {
  bridgeFreezelistProofRequest,
  unshieldFreezelistProofGrant,
  xReserveBurnFreezelistProofGrant,
} from '../../src/builders/freezelist.js'
import { createAleoClient } from '../../src/connections/aleo.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { validateBridgeRegistry } from '../../src/registry/validate.js'
import type { AleoWalletClient } from '../../src/types/aleo.js'
import { createWalletBurnInputs } from '../../examples/wallet-freezelist.js'

const asset = { chain: 'aleo', asset: 'usdcx' }
const userRecord = { type: 'record' as const, program: 'usdcx_stablecoin.aleo', recordname: 'Token' }
const derived = {
  type: 'derived' as const,
  algorithm: 'program-freezelist-exclusion-proof' as const,
  args: { freezelistProgram: { type: 'string' as const, value: 'usdcx_freezelist.aleo' } },
}
const plan = () => prepare(DEFAULT_BRIDGE_REGISTRY, {
  source: asset, destination: { chain: 'ethereum', asset: 'usdc' }, amount: '2.5',
  recipient: '0x0000000000000000000000000000000000000001',
})
const clients = (executeTransaction: AleoWalletClient['executeTransaction']) => ({
  aleo: createAleoClient({
    publicClient: {} as Parameters<typeof createAleoClient>[0]['publicClient'],
    account: { executeTransaction },
  }),
})
const withoutMetadata = () => ({
  ...DEFAULT_BRIDGE_REGISTRY,
  assets: DEFAULT_BRIDGE_REGISTRY.assets.map(entry => entry.id === 'aleo/usdcx'
    ? { ...entry, privacy: { kind: 'arc22' as const, program: 'usdcx_stablecoin.aleo' } }
    : entry),
})

describe('wallet-derived bridge freezelist proofs', () => {
  it.each([
    ['aleo', 'usdcx_freezelist.aleo'],
    ['aleo-testnet', 'test_usdcx_freezelist.aleo'],
  ])('builds a signer proof from reviewed metadata on %s', (chain, freezelistProgram) => {
    expect(bridgeFreezelistProofRequest({ registry: DEFAULT_BRIDGE_REGISTRY, asset: { chain, asset: 'usdcx' } }))
      .toEqual(freezelistProofRequest({ freezelistProgram }))
  })

  it('submits the wallet request unchanged in the ARC-22 sender-proof slot', async () => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>().mockResolvedValue('at1unshield')
    await unshield(DEFAULT_BRIDGE_REGISTRY, clients(executeTransaction), { asset, amount: '2.5', merkleProof: derived })
    expect(executeTransaction.mock.calls[0]?.[0]).toMatchObject({
      program: 'usdcx_stablecoin.aleo', function: 'transfer_private_to_public',
      inputs: [expect.anything(), '2500000u128', expect.anything(), derived],
    })
  })

  it('carries a derived proof through protocol-neutral execution into private_burn slot four', async () => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>().mockResolvedValue('at1burn')
    await execute(DEFAULT_BRIDGE_REGISTRY, clients(executeTransaction), { plan: plan(), userRecord, merkleProof: derived })
    expect(executeTransaction.mock.calls[0]?.[0]).toMatchObject({
      program: 'shielded_usdcx_wrapper.aleo', function: 'private_burn',
      inputs: [userRecord, '2500000u128', '0u32', expect.any(String), derived],
    })
  })

  it('prepares the wallet example with enough record balance and the matching grant', async () => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>().mockResolvedValue('at1example')
    const prepared = createWalletBurnInputs({ plan: plan() })
    await execute(DEFAULT_BRIDGE_REGISTRY, clients(executeTransaction), prepared.parameters)
    expect(executeTransaction.mock.calls[0]?.[0].inputs?.[0]).toMatchObject({
      type: 'record', program: 'usdcx_stablecoin.aleo', filters: { amount: { gte: '2500000u128' } },
    })
    expect(executeTransaction.mock.calls[0]?.[0].inputs?.[4]).toEqual(derived)
    expect(prepared.algorithmsAllowed).toEqual([xReserveBurnFreezelistProofGrant({ registry: DEFAULT_BRIDGE_REGISTRY, plan: plan() })])
  })

  it('grants exactly the selected unshield and wrapper proof slots', () => {
    expect(unshieldFreezelistProofGrant({ registry: DEFAULT_BRIDGE_REGISTRY, asset })).toEqual({
      algorithm: derived.algorithm, program: 'usdcx_stablecoin.aleo',
      function: 'transfer_private_to_public', inputPosition: 3,
      argConstraints: { freezelistProgram: ['usdcx_freezelist.aleo'] },
    })
    expect(xReserveBurnFreezelistProofGrant({ registry: DEFAULT_BRIDGE_REGISTRY, plan: plan() })).toEqual({
      algorithm: derived.algorithm, program: 'shielded_usdcx_wrapper.aleo',
      function: 'private_burn', inputPosition: 4,
      argConstraints: { freezelistProgram: ['usdcx_freezelist.aleo'] },
    })
  })

  it('uses current registry metadata instead of a saved plan asset or wrapper', () => {
    const saved = plan()
    saved.sourceAsset = { ...saved.sourceAsset, privacy: { kind: 'arc22', program: 'evil.aleo', freezelistProgram: 'evil.aleo' } }
    saved.route = { ...saved.route, metadata: { ...saved.route.metadata, wrapperProgram: 'evil.aleo' } }
    expect(xReserveBurnFreezelistProofGrant({ registry: DEFAULT_BRIDGE_REGISTRY, plan: saved }))
      .toMatchObject({ program: 'shielded_usdcx_wrapper.aleo', argConstraints: { freezelistProgram: ['usdcx_freezelist.aleo'] } })
  })

  it.each([
    { ...derived, algorithm: 'secret-other-algorithm' },
    { type: 'address' },
    { ...derived, args: {} },
    { ...derived, args: { freezelistProgram: { type: 'string', value: 'different.aleo' } } },
    { ...derived, args: { ...derived.args, address: { type: 'address', value: `aleo1${'q'.repeat(58)}` } } },
  ])('rejects invalid or incorrectly scoped proof requests before submission (%j)', async invalid => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()
    await expect(unshield(DEFAULT_BRIDGE_REGISTRY, clients(executeTransaction), {
      asset, amount: '2.5', merkleProof: invalid as FreezelistProofInput,
    })).rejects.toThrow(/freezelist|signer/i)
    expect(() => buildXReserveBurnCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: plan(), userRecord, merkleProof: invalid as FreezelistProofInput,
    })).toThrow(/freezelist|signer/i)
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('requires reviewed metadata for derived proofs while preserving literal inputs', async () => {
    const registry = withoutMetadata()
    expect(() => bridgeFreezelistProofRequest({ registry, asset })).toThrow(/freezelist.*metadata/i)
    expect(() => unshieldFreezelistProofGrant({ registry, asset })).toThrow(/freezelist.*metadata/i)
    expect(() => xReserveBurnFreezelistProofGrant({ registry, plan: plan() })).toThrow(/freezelist.*metadata/i)
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>().mockResolvedValue('at1literal')
    await expect(unshield(registry, clients(executeTransaction), { asset, amount: '2.5', merkleProof: derived }))
      .rejects.toThrow(/freezelist.*metadata/i)
    expect(() => buildXReserveBurnCall(registry, { plan: plan(), userRecord, merkleProof: derived }))
      .toThrow(/freezelist.*metadata/i)
    await unshield(registry, clients(executeTransaction), { asset, amount: '2.5', merkleProof: '[existing-proof]' })
    expect(executeTransaction.mock.calls[0]?.[0].inputs?.[3]).toBe('[existing-proof]')
    expect(buildXReserveBurnCall(registry, { plan: plan(), userRecord, merkleProof: '[existing-proof]' }).inputs[4])
      .toBe('[existing-proof]')
  })

  it('requires caller-supplied metadata for other ARC-22 deployments', () => {
    const bat = { chain: 'aleo', asset: 'bat' }
    expect(() => bridgeFreezelistProofRequest({ registry: DEFAULT_BRIDGE_REGISTRY, asset: bat }))
      .toThrow(/freezelist.*metadata/i)
    const registry = { ...DEFAULT_BRIDGE_REGISTRY, assets: DEFAULT_BRIDGE_REGISTRY.assets.map(entry => entry.id === 'aleo/bat'
      ? { ...entry, privacy: { ...entry.privacy!, freezelistProgram: 'reviewed_bat_freezelist.aleo' } } : entry) }
    expect(bridgeFreezelistProofRequest({ registry, asset: bat }).args.freezelistProgram.value)
      .toBe('reviewed_bat_freezelist.aleo')
  })

  it('rejects malformed freezelist registry metadata and ARC-20 proof grants', () => {
    const registry = { ...DEFAULT_BRIDGE_REGISTRY, assets: DEFAULT_BRIDGE_REGISTRY.assets.map(entry => entry.id === 'aleo/usdcx'
      ? { ...entry, privacy: { ...entry.privacy!, freezelistProgram: 'not a program' } } : entry) }
    expect(() => validateBridgeRegistry(registry)).toThrow(/freezelist/i)
    expect(() => unshieldFreezelistProofGrant({ registry: DEFAULT_BRIDGE_REGISTRY, asset: { chain: 'aleo', asset: 'sol' } }))
      .toThrow(/ARC-22/i)
  })

  it('leaves public burns independent of freezelist metadata', () => {
    const call = buildXReserveBurnCall(withoutMetadata(), { plan: plan(), mode: 'public' })
    expect(call.function).toBe('burn_public')
    expect(call.inputs).toHaveLength(3)
  })
})
