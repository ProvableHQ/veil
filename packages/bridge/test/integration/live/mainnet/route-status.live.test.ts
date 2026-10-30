import { createClient, http } from '@provablehq/veil-core'
import { describe, expect, it } from 'vitest'
import { prepare } from '../../../../src/actions/prepare.js'
import { BridgeRoutePausedError, createAleoClient, createBridgeClient, createEvmClient, evmHttp } from '../../../../src/index.js'

// Reads deployed pause flags only. No account adapter or signer is created and
// nothing is submitted.
describe.skipIf(process.env.BRIDGE_ROUTE_STATUS_READ_ONLY !== '1')('mainnet route pause flags', () => {
  const bridge = createBridgeClient({
    environment: 'mainnet',
    clients: {
      aleo: createAleoClient({
        publicClient: createClient({
          transport: http(process.env.BRIDGE_LIVE_ALEO_API_URL?.trim() || 'https://api.provable.com/v2', { network: 'mainnet' }),
        }),
      }),
      ethereum: createEvmClient({
        transport: evmHttp(process.env.BRIDGE_LIVE_ETHEREUM_RPC_URL?.trim() || 'https://ethereum-rpc.publicnode.com'),
      }),
    },
  })

  it('reads every declared flag on the active mainnet routes without an unknown outcome', async () => {
    const routes = bridge.registry.getRoutes({ environment: 'mainnet' })
      .filter((route) => route.availability === 'active' && (route.pauseSources?.length ?? 0) > 0)
    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) {
      const status = await bridge.getRouteStatus({ routeId: route.id })
      expect(status.routeId).toBe(route.id)
      expect(status.sources).toHaveLength(route.pauseSources!.length)
      // Only chains without a configured client may be skipped; configured
      // chains must answer with a definite flag value.
      for (const source of status.sources) {
        const configured = source.chainId === 'aleo' || source.chainId === 'ethereum'
        expect(source.state, `${route.id} ${JSON.stringify(source)}`).toBe(
          configured ? (source.state === 'paused' ? 'paused' : 'active') : 'skipped',
        )
      }
      expect(status.paused).toBe(status.sources.some((source) => source.state === 'paused'))
    }
  }, 120_000)

  it('refuses execution on a paused Aleo-to-Ethereum route before asking for a wallet', async () => {
    const routes = bridge.registry.getRoutes({ environment: 'mainnet', sourceChainId: 'aleo', destinationChainId: 'ethereum' })
      .filter((route) => route.availability === 'active' && (route.pauseSources?.length ?? 0) > 0)
    const statuses = await Promise.all(routes.map((route) => bridge.getRouteStatus({ routeId: route.id })))
    const paused = statuses.find((status) => status.paused)
    // Nothing to verify when every route is open; the unit suite covers the refusal path.
    if (!paused) return
    const route = routes.find((entry) => entry.id === paused.routeId)!
    const plan = prepare(bridge.registry, {
      source: { chain: 'aleo', asset: route.sourceAssetId.split('/')[1]! },
      destination: { chain: 'ethereum', asset: route.destinationAssetId.split('/')[1]! },
      amount: '0.001',
      recipient: '0x0000000000000000000000000000000000000001',
    })
    const error = await bridge.execute({ plan }).then(() => undefined, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(BridgeRoutePausedError)
    expect((error as Error).message).toContain(`${route.id} is paused on chain`)
  }, 120_000)
})
