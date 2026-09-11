import { describe, expect, it } from 'vitest'
import { prepare } from '../../src/actions/prepare.js'
import { quote } from '../../src/actions/quote.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'

describe('Aleo xReserve quote', () => {
  it('surfaces the deployed withdrawal fee and net Ethereum delivery', async () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'aleo', asset: 'usdcx' },
      destination: { chain: 'ethereum', asset: 'usdc' },
      amount: '2.000001',
      recipient: '0x0000000000000000000000000000000000000001',
    })

    const result = await quote(
      DEFAULT_BRIDGE_REGISTRY,
      { aleo: { family: 'aleo', publicClient: {} as never } },
      { plan },
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
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'aleo', asset: 'usdcx' },
      destination: { chain: 'ethereum', asset: 'usdc' },
      amount: '2',
      recipient: '0x0000000000000000000000000000000000000001',
    })

    await expect(quote(
      DEFAULT_BRIDGE_REGISTRY,
      { aleo: { family: 'aleo', publicClient: {} as never } },
      { plan },
    )).rejects.toThrow(/must exceed.*2 USDCx/i)
  })
})
