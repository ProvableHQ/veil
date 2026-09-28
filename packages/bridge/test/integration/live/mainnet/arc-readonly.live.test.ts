import { describe, expect, it } from 'vitest'
import { createBridgeClient, createEvmClient, evmHttp } from '../../../../src/index.js'

// Uses public fixture addresses only. No account adapter or signer is created.
describe.skipIf(process.env.BRIDGE_ARC_READ_ONLY !== '1')('Arc mainnet read-only quote', () => {
  it('reads the deployed USDC contract and quotes the mainnet route', async () => {
    const bridge = createBridgeClient({
      environment: 'mainnet',
      clients: {
        arc: createEvmClient({
          transport: evmHttp(process.env.BRIDGE_LIVE_ARC_RPC_URL?.trim() || 'https://rpc.mainnet.arc.io'),
        }),
      },
    })
    const quote = await bridge.quote({
      source: { chain: 'arc', asset: 'usdc' },
      destination: { chain: 'aleo', asset: 'usdcx' },
      amount: '2',
      sender: '0x0000000000000000000000000000000000000001',
      recipient: 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n',
      mintMode: 'public',
    })
    expect(quote).toMatchObject({
      kind: 'evm-xreserve', sourceChainId: 5042, remoteDomain: 10002,
      amountAtomic: 2_000_000n, maxFeeAtomic: 100_000n,
      tokenAddress: '0x3600000000000000000000000000000000000000',
      xReserveContract: '0x8888888199b2Df864bf678259607d6D5EBb4e3Ce',
    })
    if (quote.kind !== 'evm-xreserve') throw new Error('Unexpected quote')
    expect(quote.balanceAtomic).toBeGreaterThanOrEqual(0n)
    expect(quote.allowanceAtomic).toBeGreaterThanOrEqual(0n)
  }, 60_000)
})
