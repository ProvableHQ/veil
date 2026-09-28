import { describe, expect, it } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { createEvmClient, evmCustom } from '../../src/connections/evm.js'

const recipient = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const sender = '0x0000000000000000000000000000000000000001'
const intent = {
  source: { chain: 'arc', asset: 'usdc' },
  destination: { chain: 'aleo', asset: 'usdcx' },
  amount: '5', recipient, sender, mintMode: 'public' as const,
}

function client(chainId = '0x13b2') {
  const calls: string[] = []
  const bridge = createBridgeClient({
    environment: 'mainnet',
    clients: {
      arc: createEvmClient({ transport: evmCustom(async ({ method }) => {
        calls.push(method)
        if (method === 'eth_chainId') return chainId
        if (method === 'eth_call') return `0x${(10_000_000n).toString(16).padStart(64, '0')}`
        throw new Error(`Unexpected RPC method: ${method}`)
      }) }),
    },
  })
  return { bridge, calls }
}

describe('Arc mainnet xReserve', () => {
  it('quotes Arc using its pinned deployment and six-decimal USDC without a signer', async () => {
    const { bridge, calls } = client()
    const quote = await bridge.quote(intent)
    expect(quote).toMatchObject({
      kind: 'evm-xreserve', amountAtomic: 5_000_000n, sourceChainId: 5042,
      remoteDomain: 10002, tokenAddress: '0x3600000000000000000000000000000000000000',
      xReserveContract: '0x8888888199b2Df864bf678259607d6D5EBb4e3Ce',
      plan: { route: { id: 'xreserve:arc/usdc->aleo/usdcx', environment: 'mainnet' } },
    })
    expect(calls).toEqual(['eth_chainId', 'eth_call', 'eth_call'])
  })

  it('rejects an Arc testnet RPC before token reads or submission', async () => {
    const { bridge, calls } = client('0x4cef52')
    await expect(bridge.quote(intent)).rejects.toThrow('expected 5042')
    expect(calls).toEqual(['eth_chainId'])
  })

  it('keeps Arc mainnet out of testnet discovery', () => {
    const { bridge } = client()
    expect(bridge.registry.getRoutes({ environment: 'testnet', sourceChainId: 'arc' })).toEqual([])
  })
})
