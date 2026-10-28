import { describe, expect, it } from 'vitest'
import { resolveCircleOptions } from '../../src/actions/internal/circleOptions.js'
import { complete } from '../../src/actions/complete.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { prepare } from '../../src/actions/prepare.js'
import type { BridgeReceipt } from '../../src/types/protocol.js'

const REPLACEMENT = { originalTransactionId: `0x${'11'.repeat(32)}`, replacementTransactionId: `0x${'22'.repeat(32)}` }

describe('resolveCircleOptions', () => {
  it('reads grouped options and folds in the deprecated flat fields', () => {
    expect(resolveCircleOptions({ circle: { privateMintSecretNonce: '7scalar', walletPreparedDeposit: undefined } }))
      .toMatchObject({ privateMintSecretNonce: '7scalar', manualMint: undefined, approvalReplacement: undefined })
    expect(resolveCircleOptions({ privateMintSecretNonce: '7scalar' }, { manualMint: true, approvalReplacement: REPLACEMENT }))
      .toMatchObject({ privateMintSecretNonce: '7scalar', manualMint: true, approvalReplacement: REPLACEMENT })
  })

  it('accepts both forms when they agree and rejects them when they differ', () => {
    expect(resolveCircleOptions({ circle: { privateMintSecretNonce: '7scalar' }, privateMintSecretNonce: '7scalar' }))
      .toMatchObject({ privateMintSecretNonce: '7scalar' })
    expect(resolveCircleOptions({ circle: { approvalReplacement: { ...REPLACEMENT } } }, { approvalReplacement: REPLACEMENT }))
      .toMatchObject({ approvalReplacement: REPLACEMENT })
    expect(() => resolveCircleOptions({ circle: { privateMintSecretNonce: '7scalar' }, privateMintSecretNonce: '8scalar' }))
      .toThrow(/circle\.privateMintSecretNonce conflicts/)
    expect(() => resolveCircleOptions({ circle: { manualMint: false } }, { manualMint: true }))
      .toThrow(/circle\.manualMint conflicts/)
    expect(() => resolveCircleOptions(
      { circle: { approvalReplacement: { ...REPLACEMENT, replacementTransactionId: `0x${'33'.repeat(32)}` } } },
      { approvalReplacement: REPLACEMENT },
    )).toThrow(/circle\.approvalReplacement conflicts/)
  })

  it('lets complete accept the CCTP manual-mint override in either form', async () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'ethereum', asset: 'usdc' }, destination: { chain: 'arc', asset: 'usdc' },
      amount: '5', sender: `0x${'aa'.repeat(20)}`, recipient: `0x${'bb'.repeat(20)}`, cctp: { speed: 'fast', forwarding: true, maxFee: '0.1' },
    })
    const receipt: BridgeReceipt = { id: `0x${'11'.repeat(32)}`, protocol: 'cctp', status: 'DELIVERY_PENDING', protocolState: { routeId: plan.route.id } }
    const progress = { next: 'wait' as const, plan, receipt }
    // Without the override, waiting progress has nothing to complete. With it,
    // the action proceeds into the CCTP path, which then fails on network access.
    await expect(complete(DEFAULT_BRIDGE_REGISTRY, {}, { progress })).rejects.toThrow(/no destination action/)
    await expect(complete(DEFAULT_BRIDGE_REGISTRY, {}, { progress, circle: { manualMint: true } })).rejects.not.toThrow(/no destination action/)
    await expect(complete(DEFAULT_BRIDGE_REGISTRY, {}, { progress, cctp: { manualMint: true } })).rejects.not.toThrow(/no destination action/)
  })
})
