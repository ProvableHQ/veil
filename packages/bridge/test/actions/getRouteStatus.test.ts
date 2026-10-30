import { describe, expect, it, vi } from 'vitest'
import { toHex } from 'viem'
import { getRouteStatus } from '../../src/actions/getRouteStatus.js'
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

function evmClient(paused: Record<string, boolean>) {
  const call = vi.fn(async ({ to, data }: { to: string; data: string }) => {
    // OpenZeppelin Pausable `paused()` selector.
    if (data !== '0x5c975abb') throw new Error(`Unexpected call ${data}`)
    const key = to.toLowerCase()
    if (!(key in paused)) throw new Error(`Unexpected contract ${to}`)
    return toHex(paused[key] ? 1n : 0n, { size: 32 })
  })
  return { family: 'evm' as const, publicClient: { call } as never, call }
}

describe('getRouteStatus', () => {
  it('reports a paused Aleo warp program from its declared pause mapping', async () => {
    const aleo = aleoClient({
      'hyp_warp_token_eth_v2.aleo/pause/true': 'true',
      'arc20_eth.aleo/pause__/false': null,
    })

    const status = await getRouteStatus(DEFAULT_BRIDGE_REGISTRY, { aleo }, { routeId: 'hyperlane:aleo/eth->ethereum/eth' })

    expect(status.paused).toBe(true)
    expect(status.sources).toEqual([
      { chainId: 'aleo', kind: 'aleo-mapping', program: 'hyp_warp_token_eth_v2.aleo', mapping: 'pause', key: 'true', state: 'paused' },
      { chainId: 'aleo', kind: 'aleo-mapping', program: 'arc20_eth.aleo', mapping: 'pause__', key: 'false', state: 'active' },
    ])
  })

  it('reads the new-template pause__ mapping under its false key', async () => {
    const aleo = aleoClient({
      'hyp_warp_token_bat_v2.aleo/pause__/false': 'false',
      'shield_arc22_bat.aleo/pause__/false': 'false',
    })

    const status = await getRouteStatus(DEFAULT_BRIDGE_REGISTRY, { aleo }, { routeId: 'hyperlane:aleo/bat->ethereum/bat' })

    expect(status.paused).toBe(false)
    expect(status.sources.map((source) => source.state)).toEqual(['active', 'active'])
  })

  it('reads paused() on the xReserve contract alongside the Aleo bridge and token programs', async () => {
    const ethereum = evmClient({ '0x8888888199b2df864bf678259607d6d5ebb4e3ce': true })
    const aleo = aleoClient({
      'usdcx_bridge_v2.aleo/paused/true': 'false',
      'usdcx_stablecoin.aleo/pause/true': 'false',
    })

    const status = await getRouteStatus(DEFAULT_BRIDGE_REGISTRY, { ethereum, aleo }, { routeId: 'xreserve:ethereum/usdc->aleo/usdcx' })

    expect(status.paused).toBe(true)
    expect(status.sources).toEqual([
      { chainId: 'ethereum', kind: 'evm-paused', address: '0x8888888199b2Df864bf678259607d6D5EBb4e3Ce', state: 'paused' },
      { chainId: 'aleo', kind: 'aleo-mapping', program: 'usdcx_bridge_v2.aleo', mapping: 'paused', key: 'true', state: 'active' },
      { chainId: 'aleo', kind: 'aleo-mapping', program: 'usdcx_stablecoin.aleo', mapping: 'pause', key: 'true', state: 'active' },
    ])
  })

  it('reports an unreadable source as unknown without failing the other probes', async () => {
    const aleo = aleoClient({ 'arc20_eth.aleo/pause__/false': null })

    const status = await getRouteStatus(DEFAULT_BRIDGE_REGISTRY, { aleo }, { routeId: 'hyperlane:aleo/eth->ethereum/eth' })

    expect(status.paused).toBe(false)
    expect(status.sources[0]).toMatchObject({ program: 'hyp_warp_token_eth_v2.aleo', state: 'unknown', reason: expect.stringContaining('Unexpected mapping read') })
    expect(status.sources[1]).toMatchObject({ program: 'arc20_eth.aleo', state: 'active' })
  })

  it('skips a source whose chain has no configured client', async () => {
    const aleo = aleoClient({
      'usdcx_bridge_v2.aleo/paused/true': 'false',
      'usdcx_stablecoin.aleo/pause/true': 'false',
    })

    const status = await getRouteStatus(DEFAULT_BRIDGE_REGISTRY, { aleo }, { routeId: 'xreserve:ethereum/usdc->aleo/usdcx' })

    expect(status.paused).toBe(false)
    expect(status.sources[0]).toMatchObject({ kind: 'evm-paused', state: 'skipped' })
  })

  it('rejects an unknown route', async () => {
    await expect(getRouteStatus(DEFAULT_BRIDGE_REGISTRY, {}, { routeId: 'hyperlane:nowhere' }))
      .rejects.toThrow(/Unknown bridge route/)
  })
})
