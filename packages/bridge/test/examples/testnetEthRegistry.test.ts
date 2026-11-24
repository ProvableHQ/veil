import { describe, expect, it } from 'vitest'
import { DEFAULT_BRIDGE_REGISTRY, createBridgeClient, buildAleoHyperlanePrivateTransferCall, hyperlane } from '../../src/index.js'
import { prepare } from '../../src/actions/prepare.js'
import { TESTNET_ETH_REGISTRY } from '../../examples/testnet-eth-registry.js'
import { privateTransferProfile } from '../../src/protocols/hyperlane/privateTransferCall.js'

const recipient = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'

describe('testnet ETH deployment example', () => {
  it('provides two valid testnet routes without enabling the default catalog', () => {
    const bridge = createBridgeClient({ environment: 'testnet', registry: TESTNET_ETH_REGISTRY })
    expect(bridge.registry.getRoutes().map(route => route.id)).toEqual([
      'hyperlane:sepolia/eth->aleo-testnet/eth', 'hyperlane:aleo-testnet/eth->sepolia/eth',
    ])
    expect(bridge.registry.chains.every(chain => chain.environment === 'testnet')).toBe(true)
    expect(DEFAULT_BRIDGE_REGISTRY.routes.some(route => route.id.includes('sepolia/eth'))).toBe(false)
    const plan = prepare(bridge.registry, {
      source: { chain: 'sepolia', asset: 'eth' }, destination: { chain: 'aleo-testnet', asset: 'eth' },
      amount: '0.001', recipient, mintMode: 'private', hyperlane: { addressEncoding: { commitmentHex: '11'.repeat(32) } },
    })
    expect(plan.route.metadata?.privateMintProgram).toBe('test_hyp_warp_token_eth_v2.aleo')
    expect(plan.route.metadata?.destinationDomain).toBe(1617853565)
  })

  it('builds the reviewed eleven-input withdrawal with testnet programs and Sepolia enrollment', async () => {
    const plan = prepare(TESTNET_ETH_REGISTRY, {
      source: { chain: 'aleo-testnet', asset: 'eth' }, destination: { chain: 'sepolia', asset: 'eth' },
      amount: '0.001', recipient: '0x1111111111111111111111111111111111111111',
    })
    const profile = privateTransferProfile(TESTNET_ETH_REGISTRY, plan)
    expect(profile.base.usesPlaceholderConfiguration).toBe(false)
    const publicClient = { request: async ({ params }: { params: { mapping: string } }) => {
      if (params.mapping === 'private_transfer_fee_bps__') return '25u16'
      if (params.mapping === 'hooks') return '3u8'
      throw new Error(`Unexpected mapping ${params.mapping}`)
    } } as never
    const quote = await hyperlane.aleo.quotePrivateTransfer(publicClient, { registry: TESTNET_ETH_REGISTRY, plan })
    const call = buildAleoHyperlanePrivateTransferCall(TESTNET_ETH_REGISTRY, { plan, quote })
    expect(call.program).toBe('test_hyp_warp_token_eth_v2.aleo')
    expect(call.function).toBe('transfer_remote_private')
    expect(call.inputs).toHaveLength(11)
    expect(call.inputs[0]).toMatchObject({ program: 'test_arc20_eth.aleo', recordname: 'Token' })
    expect(call.inputs[4]).toContain('domain: 11155111u32')
    expect(call.inputs[4]).toContain('124u8, 74u8, 170u8, 171u8')
    expect(call.inputs[5]).toBe('11155111u32')
    expect(call.inputs[7]).toBe('1000000000000000u128')
    expect(call.inputs[10]).toBe('25u16')
    expect(quote.netAmountAtomic).toBe(997500000000000n)
  })
})
