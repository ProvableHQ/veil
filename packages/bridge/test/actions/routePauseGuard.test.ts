import { describe, expect, it, vi } from 'vitest'
import { complete } from '../../src/actions/complete.js'
import { execute } from '../../src/actions/execute.js'
import { prepare } from '../../src/actions/prepare.js'
import { quote } from '../../src/actions/quote.js'
import { resume } from '../../src/actions/resume.js'
import { BridgeError, BridgeRoutePausedError } from '../../src/errors/bridgeErrors.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'

function aleoClient(values: Record<string, string | null>) {
  const request = vi.fn(async ({ method, params }: { method: string; params: { programId: string; mapping: string; key: string } }) => {
    if (method !== 'getMappingValue') throw new Error(`Unexpected method ${method}`)
    const id = `${params.programId}/${params.mapping}/${params.key}`
    if (!(id in values)) throw new Error(`Unexpected mapping read ${id}`)
    return values[id]
  })
  return { family: 'aleo' as const, publicClient: { request } as never, request }
}

const ethPlan = prepare(DEFAULT_BRIDGE_REGISTRY, {
  source: { chain: 'aleo', asset: 'eth' },
  destination: { chain: 'ethereum', asset: 'eth' },
  amount: '0.01',
  recipient: '0x0000000000000000000000000000000000000001',
})

const PAUSED_ETH = {
  'hyp_warp_token_eth_v2.aleo/pause/true': 'true',
  'arc20_eth.aleo/pause__/false': null,
}

const ACTIVE_ETH = {
  'hyp_warp_token_eth_v2.aleo/pause/true': 'false',
  'arc20_eth.aleo/pause__/false': null,
}

describe('route pause guard', () => {
  it('execute refuses a paused route and names the paused program', async () => {
    const error = await execute(DEFAULT_BRIDGE_REGISTRY, { aleo: aleoClient(PAUSED_ETH) }, { plan: ethPlan })
      .then(() => undefined, (caught: unknown) => caught)

    expect(error).toBeInstanceOf(BridgeRoutePausedError)
    expect(error).toBeInstanceOf(BridgeError)
    expect((error as Error).message).toMatch(/hyperlane:aleo\/eth->ethereum\/eth is paused.*hyp_warp_token_eth_v2\.aleo\/pause\[true\]/)
    expect((error as BridgeRoutePausedError).status).toMatchObject({ routeId: ethPlan.route.id, paused: true })
  })

  it('execute proceeds when a pause flag could not be read, leaving enforcement to the chain', async () => {
    const aleo = aleoClient({ 'arc20_eth.aleo/pause__/false': null })

    const error = await execute(DEFAULT_BRIDGE_REGISTRY, { aleo }, { plan: ethPlan })
      .then(() => undefined, (caught: unknown) => caught)

    // No wallet is configured, so execution fails after the guard for that reason.
    expect(error).toBeInstanceOf(BridgeError)
    expect(error).not.toBeInstanceOf(BridgeRoutePausedError)
    expect((error as Error).message).not.toMatch(/pause/)
  })

  it('execute proceeds past the guard when skipRouteStatus is set', async () => {
    const aleo = aleoClient(PAUSED_ETH)

    const error = await execute(DEFAULT_BRIDGE_REGISTRY, { aleo }, { plan: ethPlan, skipRouteStatus: true })
      .then(() => undefined, (caught: unknown) => caught)

    expect(error).toBeInstanceOf(BridgeError)
    expect(error).not.toBeInstanceOf(BridgeRoutePausedError)
    expect(aleo.request).not.toHaveBeenCalled()
  })

  it('resume refuses a paused route before rebroadcasting', async () => {
    const aleo = aleoClient(PAUSED_ETH)
    const progress = {
      next: 'resume' as const,
      plan: ethPlan,
      receipt: {
        id: 'at1prepared',
        protocol: 'hyperlane' as const,
        status: 'SOURCE_SUBMISSION_PENDING' as const,
        protocolState: { routeId: ethPlan.route.id, preparedTransaction: JSON.stringify({ id: 'at1prepared' }) },
      },
    }

    await expect(resume(DEFAULT_BRIDGE_REGISTRY, { aleo }, { progress })).rejects.toThrow(BridgeRoutePausedError)
    expect(aleo.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'sendTransaction' }))
  })

  it('complete refuses a paused destination before the private mint', async () => {
    const aleo = aleoClient({
      'usdcx_bridge_v2.aleo/paused/true': 'true',
      'usdcx_stablecoin.aleo/pause/true': 'false',
    })
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'ethereum', asset: 'usdc' },
      destination: { chain: 'aleo', asset: 'usdcx' },
      amount: '2',
      recipient: 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n',
      mintMode: 'private',
    })
    const receipt = {
      id: '0xdeposit',
      protocol: 'xreserve' as const,
      status: 'DESTINATION_ACTION_REQUIRED' as const,
      nextAction: { kind: 'xreserve-private-mint' as const, chainId: 'aleo' },
      protocolState: {},
    }

    const error = await complete(DEFAULT_BRIDGE_REGISTRY, { aleo }, { plan, receipt, circle: { privateMintSecretNonce: '7scalar' } })
      .then(() => undefined, (caught: unknown) => caught)

    expect(error).toBeInstanceOf(BridgeRoutePausedError)
    expect((error as Error).message).toContain('usdcx_bridge_v2.aleo/paused[true]')
  })

  it('quote reports a paused route instead of refusing', async () => {
    const aleo = aleoClient({
      'usdcx_bridge_v2.aleo/paused/true': 'true',
      'usdcx_stablecoin.aleo/pause/true': 'false',
    })

    const result = await quote(DEFAULT_BRIDGE_REGISTRY, { aleo }, {
      source: { chain: 'aleo', asset: 'usdcx' },
      destination: { chain: 'ethereum', asset: 'usdc' },
      amount: '2.000001',
      recipient: '0x0000000000000000000000000000000000000001',
    })

    expect(result.paused).toBe(true)
    expect(result.routeStatus.sources).toEqual([
      expect.objectContaining({ kind: 'evm-paused', state: 'skipped' }),
      expect.objectContaining({ program: 'usdcx_bridge_v2.aleo', state: 'paused' }),
      expect.objectContaining({ program: 'usdcx_stablecoin.aleo', state: 'active' }),
    ])
  })

  it('quote reports an active route as unpaused', async () => {
    const aleo = aleoClient({
      'usdcx_bridge_v2.aleo/paused/true': 'false',
      'usdcx_stablecoin.aleo/pause/true': 'false',
    })

    const result = await quote(DEFAULT_BRIDGE_REGISTRY, { aleo }, {
      source: { chain: 'aleo', asset: 'usdcx' },
      destination: { chain: 'ethereum', asset: 'usdc' },
      amount: '2.000001',
      recipient: '0x0000000000000000000000000000000000000001',
    })

    expect(result.paused).toBe(false)
    expect(result.routeStatus.routeId).toBe('xreserve:aleo/usdcx->ethereum/usdc')
  })

  it('execute proceeds when every flag reads active', async () => {
    const aleo = aleoClient(ACTIVE_ETH)

    const error = await execute(DEFAULT_BRIDGE_REGISTRY, { aleo }, { plan: ethPlan })
      .then(() => undefined, (caught: unknown) => caught)

    // No wallet is configured, so execution fails after the guard for that reason.
    expect(error).toBeInstanceOf(BridgeError)
    expect(error).not.toBeInstanceOf(BridgeRoutePausedError)
    expect((error as Error).message).not.toMatch(/could not be read/)
  })
})
