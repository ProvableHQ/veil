import { describe, expect, it, vi } from 'vitest'
import { buildXReserveBurnCall, executeXReserveBurn } from '../../src/actions/xreserveBurn.js'
import { prepareTransfer } from '../../src/actions/prepareTransfer.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import type { AleoBridgeExecutor } from '../../src/types/aleo.js'

const EVM_RECIPIENT = '0x0000000000000000000000000000000000000001'
const MAINNET_RECORD = {
  type: 'record' as const,
  program: 'usdcx_stablecoin.aleo',
  recordname: 'Token',
  uid: 'record-mainnet',
}
const MERKLE_PROOF = '[{path:0field},{path:1field}]'

function plan(environment: 'mainnet' | 'testnet' = 'mainnet') {
  return prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
    routeId: environment === 'mainnet'
      ? 'xreserve:aleo/usdcx->ethereum/usdc'
      : 'xreserve:aleo-testnet/usdcx->sepolia/usdc',
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
    const executeTransaction = vi.fn<AleoBridgeExecutor['executeTransaction']>()
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

  it('submits the burn and returns service-forwarded resumable state', async () => {
    const executeTransaction = vi.fn<AleoBridgeExecutor['executeTransaction']>()
      .mockResolvedValue({ transactionId: 'at1burn' })
    const result = await executeXReserveBurn(DEFAULT_BRIDGE_REGISTRY, { executeTransaction }, {
      plan: plan(),
      userRecord: MAINNET_RECORD,
      merkleProof: MERKLE_PROOF,
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
  })
})
