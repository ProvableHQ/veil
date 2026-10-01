import { buildAleoHyperlaneTransferRemoteCall } from '../../src/builders/buildAleoHyperlaneTransferRemoteCall.js'
import { solanaRouteMetadata } from '../../src/protocols/hyperlane/solanaMetadata.js'
import { describe, expect, it, vi } from 'vitest'
import snapshot from '../fixtures/registry-2026-08-31.json'
import precedingSnapshot from '../fixtures/registry-2026-09-28.json'
import { validateBridgeRegistry } from '../../src/registry/validate.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { prepare } from '../../src/actions/prepare.js'
import { resolveTransferRoute } from '../../src/actions/internal/resolveTransferRoute.js'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { buildXReserveBurnCall } from '../../src/builders/buildXReserveBurnCall.js'
import type { BridgeCheckpoint, BridgeRegistry } from '../../src/types/protocol.js'

// Captured from main at 044fdcdede0adc53ef4d49836707bbbf9f12cd82,
// before Arc/CCTP were added. Do not regenerate from the current registry.
const legacy = validateBridgeRegistry({ ...DEFAULT_BRIDGE_REGISTRY, ...snapshot } as unknown as BridgeRegistry)
const previous = validateBridgeRegistry({
  ...DEFAULT_BRIDGE_REGISTRY,
  // Captured from PR #169 base 17a2631; never derive old deployments from current data.
  ...precedingSnapshot,
} as unknown as BridgeRegistry)
const recipient = '0x0000000000000000000000000000000000000001'
const ALEO_RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const oldPlan = () => prepare(legacy, {
  source: { chain: 'aleo', asset: 'usdcx' }, destination: { chain: 'ethereum', asset: 'usdc' },
  amount: '2.5', recipient,
})
function checkpoint(): BridgeCheckpoint {
  const plan = oldPlan()
  return {
    version: 1,
    intent: { source: { chain: 'aleo', asset: 'usdcx' }, destination: { chain: 'ethereum', asset: 'usdc' },
      bridgeProtocol: 'xreserve', amount: '2.5', recipient },
    route: { id: plan.route.id, registryVersion: legacy.version },
    source: { preparedTransaction: { transactionId: 'at1prepared', serializedTransaction: '{"id":"at1prepared"}' } },
  }
}

describe.each([
  { name: 'current default registry', targetRegistry: DEFAULT_BRIDGE_REGISTRY },
  { name: 'pinned September registry', targetRegistry: previous },
])('pre-Arc registry upgrades with $name', ({ targetRegistry }) => {
  it.each(legacy.routes.map(route => [route.id] as const))('accepts the unchanged saved route %s', id => {
    const route = legacy.routes.find(entry => entry.id === id)!
    const source = legacy.assets.find(asset => asset.id === route.sourceAssetId)!
    const destination = legacy.assets.find(asset => asset.id === route.destinationAssetId)!
    const plan = { ...oldPlan(), protocol: route.protocol, route, sourceAsset: source, destinationAsset: destination }
    expect(resolveTransferRoute(targetRegistry, plan).route.id).toBe(id)
  })

  it('builds an existing Ethereum withdrawal with the same inputs after upgrading', () => {
    const params = { plan: oldPlan(), mode: 'public-as-signer' as const }
    expect(buildXReserveBurnCall(targetRegistry, params)).toEqual(buildXReserveBurnCall(legacy, params))
  })

  it('preserves Aleo and Solana Hyperlane transaction metadata for saved plans', () => {
    const aleo = prepare(legacy, { source: { chain: 'aleo', asset: 'eth' }, destination: { chain: 'ethereum', asset: 'eth' }, amount: '1', recipient })
    expect(buildAleoHyperlaneTransferRemoteCall(targetRegistry, { plan: aleo }))
      .toEqual(buildAleoHyperlaneTransferRemoteCall(legacy, { plan: aleo }))
    const solana = prepare(legacy, { source: { chain: 'solana', asset: 'sol' }, destination: { chain: 'aleo', asset: 'sol' }, amount: '1', recipient: 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n' })
    expect(solanaRouteMetadata(targetRegistry, solana)).toEqual(solanaRouteMetadata(legacy, solana))
  })

  it('continues tracking delivery with an old plan without submitting a transaction', async () => {
    const plan = prepare(legacy, { source: { chain: 'aleo', asset: 'sol' }, destination: { chain: 'solana', asset: 'sol' }, amount: '0.000000001', recipient: '11111111111111111111111111111111' })
    const bridge = createBridgeClient({ registry: targetRegistry, clients: { solana: { family: 'solana', publicClient: { getBalance: vi.fn(async () => 101n) } as never } } })
    const receipt = await bridge.getStatus({ plan, receipt: {
      id: 'at1source', protocol: 'hyperlane', status: 'DELIVERY_PENDING', sourceTxId: 'at1source',
      protocolState: { routeId: plan.route.id, destinationBalanceBeforeAtomic: '100', expectedDestinationIncreaseAtomic: '1' },
    } })
    expect(receipt.status).toBe('COMPLETED')
  })

  it('recovers an old prepared checkpoint without signing or resubmitting', async () => {
    const client = createBridgeClient({ environment: 'mainnet', registry: targetRegistry })
    const saved = checkpoint()
    const progress = await client.recover({ checkpoint: saved })
    expect(progress.next).toBe('resume')
    expect(progress.receipt.protocolState.preparedTransaction).toBe(saved.source!.preparedTransaction!.serializedTransaction)
    expect(saved.route.registryVersion).toBe(legacy.version)
  })

  it.each(['deployment', 'decimals', 'domain', 'availability'])('rejects an old checkpoint if %s changed', async field => {
    const registry = { ...targetRegistry,
      routes: targetRegistry.routes.map(route => route.id === oldPlan().route.id
        ? { ...route, ...(field === 'deployment' ? { metadata: { ...route.metadata, bridgeProgram: 'changed.aleo' } } : {}),
          ...(field === 'availability' ? { availability: 'metadata-required' as const } : {}) } : route),
      assets: targetRegistry.assets.map(asset => asset.id === 'ethereum/usdc' && field === 'decimals' ? { ...asset, decimals: 18 } : asset),
      chains: targetRegistry.chains.map(chain => chain.id === 'ethereum' && field === 'domain' ? { ...chain, protocolDomains: { ...chain.protocolDomains, xreserve: 99 } } : chain),
    }
    expect(() => resolveTransferRoute(registry, oldPlan())).toThrow()
    await expect(createBridgeClient({ registry }).recover({ checkpoint: checkpoint() })).rejects.toThrow()
  })

  it('rejects unknown registry versions and old versions attached to new routes', () => {
    expect(() => resolveTransferRoute(targetRegistry, { ...oldPlan(), registryVersion: 'unknown' })).toThrow()
    const plan = prepare(targetRegistry, { source: { chain: 'arc', asset: 'usdc' }, destination: { chain: 'ethereum', asset: 'usdc' }, amount: '2', recipient })
    expect(() => resolveTransferRoute(targetRegistry, { ...plan, registryVersion: legacy.version })).toThrow()
  })
})

describe('BAT, USDG, and ZEC registry upgrade', () => {
  it.each([
    ['xreserve', 'ethereum', 'usdc', 'aleo', 'usdcx', '25', ALEO_RECIPIENT],
    ['cctp', 'ethereum', 'usdc', 'arc', 'usdc', '25', recipient],
    ['hyperlane', 'ethereum', 'wbtc', 'aleo', 'wbtc', '1', ALEO_RECIPIENT],
  ] as const)('accepts an unchanged %s route from the preceding snapshot', (
    bridgeProtocol,
    sourceChain,
    sourceAsset,
    destinationChain,
    destinationAsset,
    amount,
    destinationRecipient,
  ) => {
    const plan = prepare(previous, {
      source: { chain: sourceChain, asset: sourceAsset },
      destination: { chain: destinationChain, asset: destinationAsset },
      bridgeProtocol,
      amount,
      recipient: destinationRecipient,
    })
    expect(resolveTransferRoute(DEFAULT_BRIDGE_REGISTRY, plan).route.id).toBe(plan.route.id)
  })

  it('rejects a preceding-version plan for a route activated by this snapshot', () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'aleo', asset: 'zec' },
      destination: { chain: 'solana', asset: 'zec' },
      amount: '0.0001',
      recipient: '11111111111111111111111111111111',
    })
    expect(() => resolveTransferRoute(DEFAULT_BRIDGE_REGISTRY, {
      ...plan,
      registryVersion: previous.version,
    })).toThrow(/registry/i)
  })

  it('rejects an altered route even when its saved version was previously compatible', () => {
    const plan = prepare(previous, {
      source: { chain: 'ethereum', asset: 'wbtc' },
      destination: { chain: 'aleo', asset: 'wbtc' },
      amount: '1',
      recipient: ALEO_RECIPIENT,
    })
    const registry = {
      ...DEFAULT_BRIDGE_REGISTRY,
      routes: DEFAULT_BRIDGE_REGISTRY.routes.map(route => route.id === plan.route.id
        ? { ...route, metadata: { ...route.metadata, routerAddress: '0x0000000000000000000000000000000000000001' } }
        : route),
    }
    expect(() => resolveTransferRoute(registry, plan)).toThrow(/registry/i)
  })
})


describe('actual pre-PR registry recovery coverage', () => {
  it.each(previous.routes.filter(route => route.availability === 'active').map(route => [route.id] as const))(
    'accepts every previously executable route: %s', id => {
      const route = previous.routes.find(entry => entry.id === id)!
      const sourceAsset = previous.assets.find(asset => asset.id === route.sourceAssetId)!
      const destinationAsset = previous.assets.find(asset => asset.id === route.destinationAssetId)!
      const plan = { ...oldPlan(), registryVersion: previous.version, protocol: route.protocol, route, sourceAsset, destinationAsset }
      expect(resolveTransferRoute(DEFAULT_BRIDGE_REGISTRY, plan).route.id).toBe(id)
    },
  )

  it('recovers a real preceding-registry prepared checkpoint without a wallet', async () => {
    const saved = checkpoint()
    saved.route.registryVersion = previous.version
    const progress = await createBridgeClient().recover({ checkpoint: saved })
    expect(progress.next).toBe('resume')
    expect(saved.route.registryVersion).toBe(previous.version)
  })

  it('documents that an old registry rejects a new checkpoint even on unchanged routes', async () => {
    const saved = checkpoint()
    saved.route.registryVersion = DEFAULT_BRIDGE_REGISTRY.version
    await expect(createBridgeClient({ registry: previous }).recover({ checkpoint: saved })).rejects.toThrow(/checkpoint.*route/i)
  })
})
