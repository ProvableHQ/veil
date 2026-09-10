import { describe, expect, it } from 'vitest'
import { prepare } from '../../src/actions/prepare.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'

const ALEO_RECIPIENT = `aleo1${'a'.repeat(58)}`

describe('prepare', () => {
  it('resolves a route from structured source and destination endpoints', () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'ethereum', asset: 'usdc' },
      destination: { chain: 'aleo', asset: 'usdcx' },
      amount: '25',
      recipient: ALEO_RECIPIENT,
    })

    expect(plan.route.id).toBe('xreserve:ethereum/usdc->aleo/usdcx')
    expect(plan.protocol).toBe('xreserve')
  })

  it('uses bridgeProtocol to disambiguate matching endpoint routes', () => {
    const xreserve = DEFAULT_BRIDGE_REGISTRY.routes.find((route) => route.id === 'xreserve:ethereum/usdc->aleo/usdcx')!
    const registry = {
      ...DEFAULT_BRIDGE_REGISTRY,
      routes: [
        xreserve,
        { ...xreserve, id: 'alternate:ethereum/usdc->aleo/usdcx', protocol: 'hyperlane' as const },
      ],
    }
    const params = {
      source: { chain: 'ethereum', asset: 'usdc' },
      destination: { chain: 'aleo', asset: 'usdcx' },
      amount: '25',
      recipient: ALEO_RECIPIENT,
    }

    expect(() => prepare(registry, params)).toThrow(/Multiple bridge routes.*bridgeProtocol/)
    expect(prepare(registry, { ...params, bridgeProtocol: 'xreserve' }).route.id).toBe(xreserve.id)
  })

  it('prepares the xReserve deposit, attestation, and Aleo mint sequence', () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'ethereum', asset: 'usdc' },
      destination: { chain: 'aleo', asset: 'usdcx' },
      amount: '25.5',
      recipient: ALEO_RECIPIENT,
    })
    expect(plan.protocol).toBe('xreserve')
    expect(plan.steps.map((step) => step.kind)).toEqual([
      'approve', 'deposit', 'wait-attestation', 'mint',
    ])
    expect(plan.steps.find((step) => step.irreversible)?.kind).toBe('deposit')
  })

  it('prepares the xReserve burn and withdrawal sequence', () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'aleo', asset: 'usdcx' },
      destination: { chain: 'ethereum', asset: 'usdc' },
      amount: '10',
      recipient: '0x0000000000000000000000000000000000000001',
    })
    expect(plan.steps.map((step) => step.kind)).toEqual([
      'burn', 'wait-attestation', 'withdraw', 'confirm-delivery',
    ])
  })

  it('selects all Aleo mint modes and preserves the private compatibility alias', () => {
    const record = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'ethereum', asset: 'usdc' },
      destination: { chain: 'aleo', asset: 'usdcx' },
      amount: '25',
      recipient: ALEO_RECIPIENT,
      mintMode: 'record',
    })
    const privatePlan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'ethereum', asset: 'usdc' },
      destination: { chain: 'aleo', asset: 'usdcx' },
      amount: '25',
      recipient: ALEO_RECIPIENT,
      privateRecipient: true,
    })
    expect(record.mintMode).toBe('record')
    expect(record.steps.at(-1)?.description).toContain('record')
    expect(record.steps.at(-1)?.executor).toBe('protocol')
    expect(privatePlan.mintMode).toBe('private')
    expect('privateMintSecretNonce' in privatePlan).toBe(false)
    expect(privatePlan.privateRecipient).toBe(true)
    expect(privatePlan.steps.at(-1)?.executor).toBe('aleo-wallet')
    expect(() => prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'ethereum', asset: 'usdc' },
      destination: { chain: 'aleo', asset: 'usdcx' },
      amount: '25',
      recipient: ALEO_RECIPIENT,
      mintMode: 'record',
      privateRecipient: true,
    })).toThrow(/conflicts/)
  })

  it('prepares Hyperlane token approval only on non-Aleo token sources', () => {
    const inbound = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'ethereum', asset: 'wbtc' },
      destination: { chain: 'aleo', asset: 'wbtc' },
      amount: '0.1',
      recipient: ALEO_RECIPIENT,
    })
    expect(inbound.steps.map((step) => step.kind)).toEqual([
      'approve', 'dispatch', 'wait-delivery', 'confirm-delivery',
    ])
    expect(inbound.steps.at(-1)?.executor).toBe('protocol')

    const outbound = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'aleo', asset: 'wbtc' },
      destination: { chain: 'ethereum', asset: 'wbtc' },
      amount: '0.1',
      recipient: '0x0000000000000000000000000000000000000001',
    })
    expect(outbound.steps.map((step) => step.kind)).toEqual([
      'dispatch', 'wait-delivery', 'confirm-delivery',
    ])
  })

  it('rejects invalid amounts and recipients', () => {
    expect(() => prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'ethereum', asset: 'usdc' },
      destination: { chain: 'aleo', asset: 'usdcx' },
      amount: '0',
      recipient: ALEO_RECIPIENT,
    })).toThrow(/greater than zero/)
    expect(() => prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'ethereum', asset: 'usdc' },
      destination: { chain: 'aleo', asset: 'usdcx' },
      amount: '1',
      recipient: 'not-an-aleo-address',
    })).toThrow(/address format/)
    expect(() => prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'aleo', asset: 'usdcx' },
      destination: { chain: 'ethereum', asset: 'usdc' },
      amount: '1',
      recipient: '0x0000000000000000000000000000000000000001',
      privateRecipient: true,
    })).toThrow(/only valid.*Aleo/)
  })
})
