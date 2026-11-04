import { createPublicClient, http } from '@provablehq/veil-core'
import { describe, expect, it } from 'vitest'
import { createAleoClient, createBridgeClient, createEvmClient, evmHttp } from '../../../../src/index.js'

// No signer is constructed. This opt-in verifies current deployments and fees.
describe.skipIf(process.env.BRIDGE_VERULINK_READ_ONLY !== '1')('Verulink mainnet read-only', () => {
  it.each(['aleo', 'bsc'])('quotes 20 ALEO from %s using both deployed peers', async source => {
    const bridge = createBridgeClient({ clients: {
      aleo: createAleoClient({ publicClient: createPublicClient({ transport: http(
        process.env.BRIDGE_LIVE_ALEO_RPC_URL || 'https://api.explorer.provable.com/v1', { network: 'mainnet' }) }) }),
      bsc: createEvmClient({ transport: evmHttp(process.env.BRIDGE_LIVE_BSC_RPC_URL || 'https://bsc-dataseed.bnbchain.org') }),
    } })
    const quote = await bridge.quote({
      source: { chain: source, asset: 'aleo' }, destination: { chain: source === 'aleo' ? 'bsc' : 'aleo', asset: 'aleo' },
      amount: '20', recipient: source === 'aleo' ? '0x734C0a5AB55885974cEDb9D6ff71d8E8448c7375'
        : 'aleo1k5a999p502ty77ur8yryj7qmj2rtxyl8jylpnkcnfuvgyt0vxvyssyn69g',
    })
    if (quote.protocol !== 'verulink') throw new Error('Unexpected quote')
    expect(quote.amountAtomic).toBe(20000000n)
    expect(quote.feeAtomic).toBe(quote.amountAtomic * quote.rate / 100000n)
    expect(Number(quote.amountOut)).toBeGreaterThanOrEqual(10)
    console.log(JSON.stringify({ source, amountIn: quote.amountIn, amountOut: quote.amountOut, rate: quote.rate.toString() }))
  }, 60000)
})
