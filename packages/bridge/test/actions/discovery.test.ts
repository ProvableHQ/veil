import { describe, it, expect, vi } from 'vitest'
import { getAssets } from '../../src/actions/getAssets.js'
import { getProviders } from '../../src/actions/getProviders.js'
import { BridgeEnvelopeError } from '../../src/errors/bridgeErrors.js'
import type { Client } from '@provablehq/veil-core'

function makeClient(response: unknown): Client {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as Client
}

describe('getAssets', () => {
  it('returns the asset catalog', async () => {
    const client = makeClient({
      data: [
        { id: 'a1', code: 'ALEO_MAINNET', chain: 'ALEO', symbol: 'ALEO', decimals: 6, native: true },
        { id: 'a2', code: 'USDC_ETH', chain: 'EVM:1', symbol: 'USDC', decimals: 6, native: false },
      ],
    })

    const assets = await getAssets(client)

    expect(assets).toHaveLength(2)
    expect(assets[0]!.code).toBe('ALEO_MAINNET')
    expect(assets[1]!.chain).toBe('EVM:1')
    expect(client.request as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
      method: 'getBridgeAssets',
    })
  })

  it('throws BridgeEnvelopeError when the envelope has no data', async () => {
    await expect(getAssets(makeClient({}))).rejects.toThrow(BridgeEnvelopeError)
  })
})

describe('getProviders', () => {
  it('returns the provider registry', async () => {
    const client = makeClient({
      data: [
        { id: 'p1', code: 'NEAR_INTENTS', displayName: 'NEAR Intents', capabilities: ['BRIDGE'] },
        { id: 'p2', code: 'BANXA', displayName: 'Banxa', capabilities: ['BUY', 'SELL'] },
      ],
    })

    const providers = await getProviders(client)

    expect(providers).toHaveLength(2)
    expect(providers.filter((p) => p.capabilities.includes('BRIDGE'))).toHaveLength(1)
    expect(client.request as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
      method: 'getBridgeProviders',
    })
  })
})
