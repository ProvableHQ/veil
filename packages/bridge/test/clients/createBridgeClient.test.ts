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
})
