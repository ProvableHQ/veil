import { describe, expect, it, vi } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { prepare } from '../../src/actions/prepare.js'
import { createBridgeCheckpoint } from '../../src/actions/createBridgeCheckpoint.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
const recipient = '0x0000000000000000000000000000000000000001'

describe('CCTP planning and checkpoint intent', () => {
  it('describes a burn and forwarded mint, preserving the explicit fee ceiling in recovery', () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'ethereum', asset: 'usdc' }, destination: { chain: 'arc', asset: 'usdc' },
      amount: '5', recipient, cctp: { speed: 'fast', forwarding: true, maxFee: '0.10' },
    })
    expect(plan.steps.map(step => step.kind)).toEqual(['approve', 'burn', 'wait-attestation', 'mint'])
    expect(plan.steps.at(-1)?.executor).toBe('protocol')
    const checkpoint = createBridgeCheckpoint(plan, { id: 'test', protocol: 'cctp', status: 'SOURCE_CONFIRMING', sourceTxId: 'test', protocolState: { routeId: plan.route.id } })
    expect(checkpoint.intent.cctp).toEqual(plan.cctp)
    expect(prepare(DEFAULT_BRIDGE_REGISTRY, checkpoint.intent).cctp).toEqual(plan.cctp)
  })
  it('rejects CCTP settings on an unrelated route', () => {
    expect(() => prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'aleo', asset: 'usdcx' }, destination: { chain: 'ethereum', asset: 'usdc' },
      amount: '5', recipient, cctp: { speed: 'fast' },
    })).toThrow('CCTP options')
  })
  it.each([['ethereum', 0], ['base', 6], ['arbitrum', 3]] as const)('quotes %s through the client-injected HTTP transport', async (source, domain) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { finalityThreshold: 1000, minimumFee: 1, forwardFee: { medium: 15000 } },
    ])))
    const bridge = createBridgeClient({ environment: 'mainnet', fetch: fetcher })
    const quote = await bridge.quote({
      source: { chain: source, asset: 'usdc' }, destination: { chain: 'arc', asset: 'usdc' },
      amount: '5', recipient, cctp: { speed: 'fast' },
    })
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`/fees/${domain}/26?forward=true`), undefined)
    expect(quote.kind).toBe('evm-cctp')
    expect(quote.plan.cctp).toEqual({ speed: 'fast', forwarding: true, maxFee: '0.0155' })
    expect(quote.plan.amountOut).toBe('4.9845')
  })

})

it('normalizes only supported CCTP options into plans and checkpoints', () => {
  const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
    source: { chain: 'base', asset: 'usdc' }, destination: { chain: 'arc', asset: 'usdc' }, amount: '5', recipient,
    cctp: { speed: undefined, forwarding: undefined, foo: 'do-not-persist' } as never,
  })
  expect(plan.cctp).toEqual({ speed: 'standard', forwarding: true })
  const checkpoint = createBridgeCheckpoint(plan, { id: 'test', protocol: 'cctp', status: 'SOURCE_CONFIRMING', protocolState: { routeId: plan.route.id } })
  expect(checkpoint.intent.cctp).toEqual({ speed: 'standard', forwarding: true })
})
