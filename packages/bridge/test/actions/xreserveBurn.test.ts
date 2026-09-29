import { describe, expect, it, vi } from 'vitest'
import { buildXReserveBurnCall } from '../../src/builders/buildXReserveBurnCall.js'
import { execute as executeXReserveBurn } from '../../src/protocols/xreserve/aleoToEvm.js'
import { prepare } from '../../src/actions/prepare.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import type { AleoWalletClient } from '../../src/types/aleo.js'

const EVM_RECIPIENT = '0x0000000000000000000000000000000000000001'
const MAINNET_RECORD = {
  type: 'record' as const,
  program: 'usdcx_stablecoin.aleo',
  recordname: 'Token',
  uid: 'record-mainnet',
}
const MERKLE_PROOF = '[{path:0field},{path:1field}]'

function plan(environment: 'mainnet' | 'testnet' = 'mainnet') {
  return prepare(DEFAULT_BRIDGE_REGISTRY, {
    source: { chain: environment === 'mainnet' ? 'aleo' : 'aleo-testnet', asset: 'usdcx' },
    destination: { chain: environment === 'mainnet' ? 'ethereum' : 'sepolia', asset: 'usdc' },
    bridgeProtocol: 'xreserve',
    amount: '2.5',
    recipient: EVM_RECIPIENT,
  })
}

describe('xReserve USDCx burns', () => {
  it('defaults to the wrapper private_burn transition', () => {
    const call = buildXReserveBurnCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: plan(),
      userRecord: MAINNET_RECORD,
      merkleProof: MERKLE_PROOF,
    })
    expect(call).toMatchObject({
      mode: 'private',
      program: 'shielded_usdcx_wrapper.aleo',
      function: 'private_burn',
      amountAtomic: 2_500_000n,
      nativeDomain: 0,
      nativeRecipientBytes32: `0x${'00'.repeat(31)}01`,
    })
    expect(call.inputs).toEqual([
      MAINNET_RECORD,
      '2500000u128',
      '0u32',
      `[${Array.from({ length: 31 }, () => '0u8').concat('1u8').join(',')}]`,
      MERKLE_PROOF,
    ])
  })

  it('exposes burn_public explicitly for composable public balances', () => {
    expect(buildXReserveBurnCall(DEFAULT_BRIDGE_REGISTRY, { plan: plan(), mode: 'public' }))
      .toMatchObject({ program: 'usdcx_bridge_v2.aleo', function: 'burn_public' })
  })

  it('retains the EOA-bound public signer transition as an explicit mode', () => {
    expect(buildXReserveBurnCall(DEFAULT_BRIDGE_REGISTRY, { plan: plan(), mode: 'public-as-signer' }))
      .toMatchObject({ program: 'usdcx_bridge_v2.aleo', function: 'burn_public_as_signer' })
  })

  it('routes private records through the wrapper with the record and proof first', () => {
    const userRecord = {
      type: 'record' as const,
      program: 'test_usdcx_stablecoin.aleo',
      recordname: 'Token',
      uid: 'record-1',
    }
    const call = buildXReserveBurnCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: plan('testnet'),
      mode: 'private',
      userRecord,
      merkleProof: MERKLE_PROOF,
    })
    expect(call.program).toBe('shielded_usdcx_wrapper.aleo')
    expect(call.function).toBe('private_burn')
    expect(call.inputs).toEqual([
      userRecord,
      '2500000u128',
      '0u32',
      `[${Array.from({ length: 31 }, () => '0u8').concat('1u8').join(',')}]`,
      MERKLE_PROOF,
    ])
  })

  it('rejects incomplete private inputs before prompting the wallet', async () => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()
    await expect(executeXReserveBurn(DEFAULT_BRIDGE_REGISTRY, { executeTransaction }, {
      plan: plan(),
      mode: 'private',
    })).rejects.toThrow(/userRecord/)
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('rejects unknown burn modes at runtime', () => {
    expect(() => buildXReserveBurnCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: plan(),
      mode: 'unknown' as 'public',
    })).toThrow(/Unsupported USDCx burn mode/)
  })

  it('rejects a burn that cannot cover the deployed withdrawal fee', () => {
    const transferPlan = plan()
    const feeOnlyPlan = { ...transferPlan, amountIn: '2' }

    expect(() => buildXReserveBurnCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: feeOnlyPlan,
      mode: 'public-as-signer',
    })).toThrow(/must exceed.*2 USDCx/i)
  })

  it('submits the burn and returns service-forwarded resumable state', async () => {
    const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()
      .mockResolvedValue('at1burn')
    const checkpoints: unknown[] = []
    const result = await executeXReserveBurn(DEFAULT_BRIDGE_REGISTRY, { executeTransaction }, {
      plan: plan(),
      userRecord: MAINNET_RECORD,
      merkleProof: MERKLE_PROOF,
      onSubmitted(receipt) { checkpoints.push(receipt) },
    })
    expect(executeTransaction).toHaveBeenCalledWith(expect.objectContaining({
      program: 'shielded_usdcx_wrapper.aleo',
      function: 'private_burn',
    }))
    expect(result.receipt).toMatchObject({
      status: 'SOURCE_CONFIRMING',
      sourceTxId: 'at1burn',
      protocolState: { forwardingService: 'aleo-burn-attestation', nativeDomain: 0 },
    })
    expect(checkpoints).toEqual([result.receipt])
  })
})


describe('Aleo to Arc burns', () => {
  const arcPlan = () => prepare(DEFAULT_BRIDGE_REGISTRY, {
    source: { chain: 'aleo', asset: 'usdcx' },
    destination: { chain: 'arc', asset: 'usdc' },
    amount: '2', recipient: EVM_RECIPIENT,
  })
  it.each(['private', 'public', 'public-as-signer'] as const)('encodes Arc domain 26 for %s funding', (mode) => {
    const call = buildXReserveBurnCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: arcPlan(), mode, userRecord: MAINNET_RECORD, merkleProof: MERKLE_PROOF,
    })
    expect(call.nativeDomain).toBe(26)
    expect(call.inputs).toContain('26u32')
    expect(call.amountAtomic).toBe(2_000_000n)
  })
  it('rejects a destination domain that disagrees with the reviewed chain', () => {
    const registry = { ...DEFAULT_BRIDGE_REGISTRY, routes: DEFAULT_BRIDGE_REGISTRY.routes.map(route =>
      route.id === 'xreserve:aleo/usdcx->arc/usdc'
        ? { ...route, metadata: { ...route.metadata, arcDestinationDomain: 0 } } : route) }
    expect(() => buildXReserveBurnCall(registry, { plan: arcPlan(), mode: 'public' })).toThrow(/destination domain/)
  })
  it('rejects amounts below the deployed two-USDCx minimum', () => {
    expect(() => buildXReserveBurnCall(DEFAULT_BRIDGE_REGISTRY, {
      plan: { ...arcPlan(), amountIn: '1' }, mode: 'public',
    })).toThrow(/minimum/)
  })
})


it('rechecks the live Arc fee before asking the wallet to burn', async () => {
  const transferPlan = prepare(DEFAULT_BRIDGE_REGISTRY, {
    source: { chain: 'aleo', asset: 'usdcx' }, destination: { chain: 'arc', asset: 'usdc' },
    amount: '2', recipient: EVM_RECIPIENT,
  })
  const executeTransaction = vi.fn<AleoWalletClient['executeTransaction']>()
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ withdrawalFeeBaseUnits: '2000000' })))
  await expect(executeXReserveBurn(DEFAULT_BRIDGE_REGISTRY, { executeTransaction }, {
    plan: transferPlan, userRecord: MAINNET_RECORD, merkleProof: MERKLE_PROOF,
  }, fetcher)).rejects.toThrow(/fee/)
  expect(executeTransaction).not.toHaveBeenCalled()
})
