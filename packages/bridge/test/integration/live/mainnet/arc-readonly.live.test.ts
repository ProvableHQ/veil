import { createPublicClient, http, pad, parseAbi, type Address } from 'viem'
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


const CCTP_READ_ABI = parseAbi([
  'function localDomain() view returns (uint32)',
  'function remoteTokenMessengers(uint32) view returns (bytes32)',
  'function decimals() view returns (uint8)',
])

describe.skipIf(process.env.BRIDGE_ARC_READ_ONLY !== '1')('Arc outbound CCTP mainnet read-only verification', () => {
  it.each([
    ['ethereum', 1, 0, 'https://ethereum-rpc.publicnode.com'],
    ['base', 8453, 6, 'https://base-rpc.publicnode.com'],
    ['arbitrum', 42161, 3, 'https://arbitrum-one-rpc.publicnode.com'],
  ] as const)('verifies deployments and quotes Arc to %s', async (destination, chainId, domain, defaultRpc) => {
    const bridge = createBridgeClient({ environment: 'mainnet' })
    const route = bridge.registry.routes.find(entry => entry.id === `cctp:arc/usdc->${destination}/usdc`)!
    const messenger = route.metadata!.tokenMessenger as Address
    const transmitter = route.metadata!.messageTransmitter as Address
    const arc = createPublicClient({ transport: http(process.env.BRIDGE_LIVE_ARC_RPC_URL?.trim() || 'https://rpc.mainnet.arc.io') })
    const target = createPublicClient({ transport: http(process.env[`BRIDGE_LIVE_${destination.toUpperCase()}_RPC_URL`]?.trim() || defaultRpc) })
    const token = bridge.registry.assets.find(asset => asset.id === `${destination}/usdc`)!.locator!.value as Address
    expect(await arc.getChainId()).toBe(5042)
    expect(await target.getChainId()).toBe(chainId)
    expect(await arc.readContract({ address: transmitter, abi: CCTP_READ_ABI, functionName: 'localDomain' })).toBe(26)
    expect(await target.readContract({ address: transmitter, abi: CCTP_READ_ABI, functionName: 'localDomain' })).toBe(domain)
    expect((await arc.readContract({ address: messenger, abi: CCTP_READ_ABI, functionName: 'remoteTokenMessengers', args: [domain] })).toLowerCase()).toBe(pad(messenger, { size: 32 }).toLowerCase())
    expect((await target.readContract({ address: messenger, abi: CCTP_READ_ABI, functionName: 'remoteTokenMessengers', args: [26] })).toLowerCase()).toBe(pad(messenger, { size: 32 }).toLowerCase())
    expect(await target.readContract({ address: token, abi: CCTP_READ_ABI, functionName: 'decimals' })).toBe(6)
    const quote = await bridge.quote({
      source: { chain: 'arc', asset: 'usdc' }, destination: { chain: destination, asset: 'usdc' },
      amount: '10', recipient: '0x0000000000000000000000000000000000000001',
      cctp: { speed: 'standard', forwarding: true },
    })
    if (quote.kind !== 'evm-cctp') throw new Error('Unexpected quote kind')
    expect(quote.minFinalityThreshold).toBe(2000)
    expect(quote.amountOutAtomic).toBeGreaterThan(0n)
    expect(quote.maxFeeAtomic).toBe(quote.protocolFeeAtomic + quote.forwardingFeeAtomic)
    console.table({ destination, forwardingFeeAtomic: quote.forwardingFeeAtomic.toString(), amountOut: quote.plan.amountOut })
  }, 60_000)
})
