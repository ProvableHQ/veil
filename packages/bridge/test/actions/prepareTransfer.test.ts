import { describe, expect, it } from 'vitest'
import { prepareTransfer } from '../../src/actions/prepareTransfer.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'

const ALEO_RECIPIENT = `aleo1${'a'.repeat(58)}`

describe('prepareTransfer', () => {
  it('prepares the xReserve deposit, attestation, and Aleo mint sequence', () => {
    const plan = prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:ethereum/usdc->aleo/usdcx',
      amount: '25.5',
      recipient: ALEO_RECIPIENT,
    })
    expect(plan.protocol).toBe('xreserve')
    expect(plan.quote.status).toBe('not-queried')
    expect(plan.steps.map((step) => step.kind)).toEqual([
      'approve', 'deposit', 'wait-attestation', 'mint',
    ])
    expect(plan.steps.find((step) => step.irreversible)?.kind).toBe('deposit')
  })

  it('prepares the xReserve burn and withdrawal sequence', () => {
    const plan = prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:aleo/usdcx->ethereum/usdc',
      amount: '10',
      recipient: '0x0000000000000000000000000000000000000001',
    })
    expect(plan.steps.map((step) => step.kind)).toEqual([
      'burn', 'wait-attestation', 'withdraw', 'confirm-delivery',
    ])
  })

  it('selects all Aleo mint modes and preserves the private compatibility alias', () => {
    const record = prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:ethereum/usdc->aleo/usdcx',
      amount: '25',
      recipient: ALEO_RECIPIENT,
      mintMode: 'record',
    })
    const privatePlan = prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:ethereum/usdc->aleo/usdcx',
      amount: '25',
      recipient: ALEO_RECIPIENT,
      privateRecipient: true,
    })
    expect(record.mintMode).toBe('record')
    expect(record.steps.at(-1)?.description).toContain('record')
    expect(record.steps.at(-1)?.executor).toBe('protocol')
    expect(privatePlan.mintMode).toBe('private')
    expect(privatePlan.privateMintSecretNonce).toBe('0scalar')
    expect(privatePlan.privateRecipient).toBe(true)
    expect(privatePlan.steps.at(-1)?.executor).toBe('aleo-wallet')
    const customNoncePlan = prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:ethereum/usdc->aleo/usdcx',
      amount: '25',
      recipient: ALEO_RECIPIENT,
      mintMode: 'private',
      privateMintSecretNonce: '7scalar',
    })
    expect(customNoncePlan.privateMintSecretNonce).toBe('7scalar')
    expect(() => prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:ethereum/usdc->aleo/usdcx',
      amount: '25',
      recipient: ALEO_RECIPIENT,
      mintMode: 'record',
      privateRecipient: true,
    })).toThrow(/conflicts/)
    expect(() => prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:ethereum/usdc->aleo/usdcx',
      amount: '25',
      recipient: ALEO_RECIPIENT,
      mintMode: 'record',
      privateMintSecretNonce: '7scalar',
    })).toThrow(/only valid with private/)
    expect(() => prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:ethereum/usdc->aleo/usdcx',
      amount: '25',
      recipient: ALEO_RECIPIENT,
      mintMode: 'private',
      privateMintSecretNonce: 'not-a-scalar',
    })).toThrow(/decimal Aleo scalar/)
  })

  it('prepares Hyperlane token approval only on non-Aleo token sources', () => {
    const inbound = prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'hyperlane:ethereum/wbtc->aleo/wbtc',
      amount: '0.1',
      recipient: ALEO_RECIPIENT,
    })
    expect(inbound.steps.map((step) => step.kind)).toEqual([
      'approve', 'dispatch', 'wait-delivery', 'confirm-delivery',
    ])
    expect(inbound.steps.at(-1)?.executor).toBe('protocol')

    const outbound = prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'hyperlane:aleo/wbtc->ethereum/wbtc',
      amount: '0.1',
      recipient: '0x0000000000000000000000000000000000000001',
    })
    expect(outbound.steps.map((step) => step.kind)).toEqual([
      'dispatch', 'wait-delivery', 'confirm-delivery',
    ])
  })

  it('rejects invalid amounts and recipients', () => {
    expect(() => prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:ethereum/usdc->aleo/usdcx',
      amount: '0',
      recipient: ALEO_RECIPIENT,
    })).toThrow(/greater than zero/)
    expect(() => prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:ethereum/usdc->aleo/usdcx',
      amount: '1',
      recipient: 'not-an-aleo-address',
    })).toThrow(/address format/)
    expect(() => prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:aleo/usdcx->ethereum/usdc',
      amount: '1',
      recipient: '0x0000000000000000000000000000000000000001',
      privateRecipient: true,
    })).toThrow(/only valid.*Aleo/)
  })
})
