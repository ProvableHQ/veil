import { describe, expect, it, vi } from 'vitest'
import { quote } from '../../src/actions/quote.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'

describe('Aleo xReserve quote', () => {
  it('surfaces the deployed withdrawal fee and net Ethereum delivery', async () => {
    const params = {
      source: { chain: 'aleo', asset: 'usdcx' },
      destination: { chain: 'ethereum', asset: 'usdc' },
      amount: '2.000001',
      recipient: '0x0000000000000000000000000000000000000001',
    }

    const result = await quote(
      DEFAULT_BRIDGE_REGISTRY,
      { aleo: { family: 'aleo', publicClient: {} as never } },
      params,
    )

    expect(result).toMatchObject({
      kind: 'aleo-xreserve',
      amountIn: '2.000001',
      amountOut: '0.000001',
      fees: [{
        kind: 'protocol',
        chainId: 'aleo',
        assetId: 'aleo/usdcx',
        amount: '2',
        estimated: false,
      }],
    })
  })

  it('rejects an amount that cannot cover the withdrawal fee', async () => {
    const params = {
      source: { chain: 'aleo', asset: 'usdcx' },
      destination: { chain: 'ethereum', asset: 'usdc' },
      amount: '2',
      recipient: '0x0000000000000000000000000000000000000001',
    }

    await expect(quote(
      DEFAULT_BRIDGE_REGISTRY,
      { aleo: { family: 'aleo', publicClient: {} as never } },
      params,
    )).rejects.toThrow(/must exceed.*2 USDCx/i)
  })

  it('reports the same display amount when source and destination decimals differ', async () => {
    const registry = {
      ...DEFAULT_BRIDGE_REGISTRY,
      assets: DEFAULT_BRIDGE_REGISTRY.assets.map((asset) =>
        asset.id === 'ethereum/usdc' ? { ...asset, decimals: 18 } : asset),
    }

    const result = await quote(
      registry,
      { aleo: { family: 'aleo', publicClient: {} as never } },
      {
        source: { chain: 'aleo', asset: 'usdcx' },
        destination: { chain: 'ethereum', asset: 'usdc' },
        amount: '2.000001',
        recipient: '0x0000000000000000000000000000000000000001',
      },
    )

    if (result.kind !== 'aleo-xreserve') throw new Error('Unexpected quote kind')
    expect(result.amountOut).toBe('0.000001')
  })
})


describe('Aleo to Arc quotes', () => {
  const params = {
    source: { chain: 'aleo', asset: 'usdcx' },
    destination: { chain: 'arc', asset: 'usdc' },
    amount: '2', recipient: '0x0000000000000000000000000000000000000001',
  }
  it('uses the live Arc withdrawal estimate without wallet access', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ withdrawalFeeBaseUnits: '16400' })))
    const result = await quote(DEFAULT_BRIDGE_REGISTRY, {}, params, fetcher)
    expect(fetcher).toHaveBeenCalledWith('https://api.usdcx.aleo.org/api/estimate-burn-fee', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ evmChain: 'arc', amountUsdc: '2' }),
    }))
    expect(result).toMatchObject({ amountOut: '1.9836', fees: [{ amount: '0.0164', estimated: true }] })
  })
  it.each(['bad', '-1', '2000000'])('rejects invalid or unaffordable live fee %s', async fee => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ withdrawalFeeBaseUnits: fee })))
    await expect(quote(DEFAULT_BRIDGE_REGISTRY, {}, params, fetcher)).rejects.toThrow(/fee/)
  })
  it('rejects below-minimum burns before fetching fees', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(quote(DEFAULT_BRIDGE_REGISTRY, {}, { ...params, amount: '1' }, fetcher)).rejects.toThrow(/minimum/)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('surfaces provider failures instead of presenting a stale fee as exact', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }))
    await expect(quote(DEFAULT_BRIDGE_REGISTRY, {}, params, fetcher)).rejects.toThrow(/503/)
  })
})
