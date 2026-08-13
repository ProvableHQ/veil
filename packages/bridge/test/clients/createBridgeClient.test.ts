import { describe, expect, it } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'

describe('createBridgeClient', () => {
  it('defaults discovery to mainnet and remains extendable', () => {
    const client = createBridgeClient()
    expect(client.environment).toBe('mainnet')
    expect(client.getAssets().every((asset) => !asset.chainId.includes('testnet') && asset.chainId !== 'sepolia')).toBe(true)
    expect(client.extend(() => ({ hello: () => 'world' })).hello()).toBe('world')
  })

  it('selects testnet without hiding explicit environment queries', () => {
    const client = createBridgeClient({ environment: 'testnet' })
    expect(client.getRoutes().every((route) => route.environment === 'testnet')).toBe(true)
    expect(client.getRoutes({ environment: 'mainnet' }).length).toBeGreaterThan(0)
  })

  it('binds transfer planning to the configured registry', () => {
    const client = createBridgeClient()
    const plan = client.prepareTransfer({
      routeId: 'xreserve:aleo/usdcx->ethereum/usdc',
      amount: '1',
      recipient: '0x0000000000000000000000000000000000000001',
    })
    expect(plan.registryVersion).toBe(client.registry.version)
  })

  it('requires an injected EVM executor for live Hyperlane actions', async () => {
    const client = createBridgeClient()
    const plan = client.prepareTransfer({
      routeId: 'hyperlane:ethereum/eth->aleo/eth',
      amount: '1',
      recipient: `aleo1${'a'.repeat(58)}`,
    })
    await expect(client.quoteEvmHyperlaneTransfer({
      plan,
      recipientBytes32: '0x20e3629764d5338f74bee96675801b1fb29d1fc68b177668f9175708bef84311',
    })).rejects.toThrow(/EVM executor is required/)
  })

  it('binds the injected Circle attestation transport', async () => {
    const messageHash = `0x${'11'.repeat(32)}` as const
    const client = createBridgeClient({
      environment: 'testnet',
      xReserveHttpTransport: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    })
    await expect(client.getXReserveAttestation({
      routeId: 'xreserve:sepolia/usdc->aleo-testnet/usdcx',
      messageHash,
    })).resolves.toEqual({ status: 'pending', messageHash })
  })
})
