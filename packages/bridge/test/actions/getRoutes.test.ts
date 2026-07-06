import { describe, it, expect, vi } from 'vitest'
import { getRoutes } from '../../src/actions/getRoutes.js'
import type { Client } from '@veil/core'

const sp = (...codes: string[]) => codes.map((c) => ({ providerId: `id-${c}`, providerCode: c }))

// A small catalog: native ALEO (NEAR+HALLIDAY), wrapped USDC on Aleo
// (HALLIDAY only), USDC on Ethereum (all three), SOL (NEAR+HOUDINI),
// an unsupported external asset, and an unsupported Aleo asset.
const CATALOG = [
  { id: '1', code: 'ALEO_MAINNET', chain: 'ALEO', symbol: 'ALEO', decimals: 6, native: true, supportedProviders: sp('NEAR_INTENTS', 'HALLIDAY') },
  { id: '2', code: 'USDC_ALEO', chain: 'ALEO', symbol: 'USDC', decimals: 6, native: false, supportedProviders: sp('HALLIDAY') },
  { id: '3', code: 'USDC_ETH', chain: 'EVM:1', symbol: 'USDC', decimals: 6, native: false, supportedProviders: sp('HOUDINI', 'NEAR_INTENTS', 'HALLIDAY') },
  { id: '4', code: 'SOL_SOLANA', chain: 'SOLANA', symbol: 'SOL', decimals: 9, native: true, supportedProviders: sp('NEAR_INTENTS', 'HOUDINI') },
  { id: '5', code: 'DEAD_BASE', chain: 'EVM:8453', symbol: 'DEAD', decimals: 18, native: false, supportedProviders: [] },
  { id: '6', code: 'DEAD_ALEO', chain: 'ALEO', symbol: 'DEAD2', decimals: 6, native: false },
]

function makeClient(): Client {
  return { request: vi.fn().mockResolvedValue({ data: CATALOG }) } as unknown as Client
}

describe('getRoutes', () => {
  it('pairs assets sharing a provider, Aleo always one side', async () => {
    const routes = await getRoutes(makeClient())

    const keys = routes.map((r) => `${r.aleoAsset.code}<->${r.externalAsset.code}`)
    expect(keys).toEqual([
      'ALEO_MAINNET<->USDC_ETH', // via NEAR+HALLIDAY
      'ALEO_MAINNET<->SOL_SOLANA', // via NEAR
      'USDC_ALEO<->USDC_ETH', // via HALLIDAY
    ])
    // USDC_ALEO (HALLIDAY only) × SOL_SOLANA (NEAR+HOUDINI): no shared provider.
    // DEAD_* assets: no providers → on no route.
  })

  it('reports the shared providers per pair', async () => {
    const routes = await getRoutes(makeClient())
    const solRoute = routes.find((r) => r.externalAsset.code === 'SOL_SOLANA')!
    expect(solRoute.providers).toEqual(['NEAR_INTENTS'])
    const usdc = routes.find((r) => r.aleoAsset.code === 'USDC_ALEO')!
    expect(usdc.providers).toEqual(['HALLIDAY'])
  })

  it('enriches both sides with the chain display name', async () => {
    const routes = await getRoutes(makeClient())
    const r = routes.find((x) => x.externalAsset.code === 'USDC_ETH')!
    expect(r.aleoAsset.chainName).toBe('Aleo')
    expect(r.externalAsset.chainName).toBe('Ethereum')
  })

  it('filters by external chain identifier', async () => {
    const routes = await getRoutes(makeClient(), { externalChain: 'SOLANA' })
    expect(routes).toHaveLength(1)
    expect(routes[0]!.externalAsset.code).toBe('SOL_SOLANA')
  })

  it('accepts the chain display name (case-insensitively) as the chain filter', async () => {
    // Results carry chainName, so callers naturally filter by it too.
    const byName = await getRoutes(makeClient(), { externalChain: 'Solana' })
    expect(byName).toHaveLength(1)
    expect(byName[0]!.externalAsset.code).toBe('SOL_SOLANA')

    const byNameForEvm = await getRoutes(makeClient(), { externalChain: 'ethereum' })
    expect(byNameForEvm.map((r) => r.externalAsset.code)).toEqual(['USDC_ETH', 'USDC_ETH'])

    const byLowerId = await getRoutes(makeClient(), { externalChain: 'evm:1' })
    expect(byLowerId).toHaveLength(2)
  })

  it('filters by symbol on either side, case-insensitively', async () => {
    for (const symbol of ['USDC', 'usdc', 'Usdc']) {
      const routes = await getRoutes(makeClient(), { symbol })
      const keys = routes.map((r) => `${r.aleoAsset.code}<->${r.externalAsset.code}`)
      // Matches USDC on the Aleo side AND on the external side.
      expect(keys).toEqual(['ALEO_MAINNET<->USDC_ETH', 'USDC_ALEO<->USDC_ETH'])
    }
  })

  it('filters by provider, case-insensitively', async () => {
    for (const provider of ['HALLIDAY', 'halliday']) {
      const routes = await getRoutes(makeClient(), { provider })
      const keys = routes.map((r) => `${r.aleoAsset.code}<->${r.externalAsset.code}`)
      expect(keys).toEqual(['ALEO_MAINNET<->USDC_ETH', 'USDC_ALEO<->USDC_ETH'])
    }
  })

  it('treats empty-string filters as no filter (a blank UI picker)', async () => {
    const all = await getRoutes(makeClient())
    const blank = await getRoutes(makeClient(), { externalChain: '', symbol: '', provider: '' })
    expect(blank).toEqual(all)
  })

  it('dedups a provider listed twice with different integration types', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [
          {
            id: '1', code: 'ALEO_MAINNET', chain: 'ALEO', symbol: 'ALEO', decimals: 6, native: true,
            supportedProviders: [
              { providerId: 'x', providerCode: 'HALLIDAY', integrationType: 'CEX' },
              { providerId: 'x', providerCode: 'HALLIDAY', integrationType: 'DEX' },
            ],
          },
          {
            id: '2', code: 'SOL_SOLANA', chain: 'SOLANA', symbol: 'SOL', decimals: 9, native: true,
            supportedProviders: sp('HALLIDAY'),
          },
        ],
      }),
    } as unknown as Client
    const routes = await getRoutes(client)
    expect(routes[0]!.providers).toEqual(['HALLIDAY'])
  })
})
