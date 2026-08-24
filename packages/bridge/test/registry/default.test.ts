import { describe, expect, it } from 'vitest'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { validateBridgeRegistry } from '../../src/registry/validate.js'
import { BridgeError } from '../../src/errors/bridgeErrors.js'

describe('DEFAULT_BRIDGE_REGISTRY', () => {
  it('routes USDCx only through xReserve', () => {
    const usdcxRoutes = DEFAULT_BRIDGE_REGISTRY.routes.filter((route) =>
      route.sourceAssetId.includes('usdcx') || route.destinationAssetId.includes('usdcx'))
    expect(usdcxRoutes.length).toBeGreaterThan(0)
    expect(usdcxRoutes.every((route) => route.protocol === 'xreserve')).toBe(true)
  })

  it('routes the requested non-USDCx assets through Hyperlane', () => {
    for (const symbol of ['ETH', 'WBTC', 'USDT', 'SOL', 'ALEO', 'USAD']) {
      const assetIds = new Set(DEFAULT_BRIDGE_REGISTRY.assets
        .filter((asset) => asset.symbol === symbol)
        .map((asset) => asset.id))
      const routes = DEFAULT_BRIDGE_REGISTRY.routes.filter((route) =>
        assetIds.has(route.sourceAssetId) || assetIds.has(route.destinationAssetId))
      expect(routes.length, symbol).toBeGreaterThan(0)
      expect(routes.every((route) => route.protocol === 'hyperlane'), symbol).toBe(true)
    }
  })

  it('passes registry validation', () => {
    expect(validateBridgeRegistry(DEFAULT_BRIDGE_REGISTRY)).toBe(DEFAULT_BRIDGE_REGISTRY)
    expect(DEFAULT_BRIDGE_REGISTRY.routes[0]!.metadata?.xReserveContract)
      .toBe('0x8888888199b2Df864bf678259607d6D5EBb4e3Ce')
  })

  it('activates xReserve deposits and service-forwarded Aleo burns', () => {
    const xreserve = DEFAULT_BRIDGE_REGISTRY.routes.filter((route) => route.protocol === 'xreserve')
    expect(xreserve.every((route) => route.availability === 'active')).toBe(true)
    expect(xreserve.every((route) => route.metadata?.ethereumDestinationDomain === 0)).toBe(true)
    expect(xreserve.every((route) => route.metadata?.arcDestinationDomain === 26)).toBe(true)
  })

  it('pins executable Ethereum Hyperlane routes to a reviewed registry commit', () => {
    const inboundAssets = new Set(['ethereum/eth', 'ethereum/wbtc', 'ethereum/usdt'])
    const inbound = DEFAULT_BRIDGE_REGISTRY.routes.filter((route) =>
      route.protocol === 'hyperlane' && inboundAssets.has(route.sourceAssetId))
    expect(inbound.map((route) => route.sourceAssetId)).toEqual(expect.arrayContaining([
      'ethereum/eth',
      'ethereum/wbtc',
      'ethereum/usdt',
    ]))
    expect(inbound.every((route) => route.availability === 'active')).toBe(true)
    expect(inbound.every((route) => route.metadata?.registryCommit === '2621c16f2db1ccb46643265c110dac5ca2c7c51a')).toBe(true)
  })

  it('marks Aleo-origin Warp Route configuration as non-executable placeholders', () => {
    const routeIds = new Set([
      'hyperlane:aleo/eth->ethereum/eth',
      'hyperlane:aleo/wbtc->ethereum/wbtc',
      'hyperlane:aleo/usdt->ethereum/usdt',
      'hyperlane:aleo/sol->solana/sol',
      'hyperlane:aleo/usad->ethereum/usad',
    ])
    const routes = DEFAULT_BRIDGE_REGISTRY.routes.filter((route) => routeIds.has(route.id))
    expect(routes).toHaveLength(5)
    expect(routes.every((route) => route.availability === 'metadata-required')).toBe(true)
    expect(routes.every((route) => route.metadata?.aleoPlaceholderConfiguration === true)).toBe(true)
    expect(routes.map((route) => route.metadata?.aleoRouterProgram)).toEqual([
      'hyp_warp_token_eth_v2.aleo',
      'hyp_warp_token_wbtc_v2.aleo',
      'hyp_warp_token_usdt_v2.aleo',
      'hyp_warp_token_sol_v2.aleo',
      'hyp_warp_token_usad_v2.aleo',
    ])
  })

  it('pins verified Aleo WBTC app metadata without activating the route', () => {
    const route = DEFAULT_BRIDGE_REGISTRY.routes.find((entry) =>
      entry.id === 'hyperlane:aleo/wbtc->ethereum/wbtc')!
    expect(route).toMatchObject({ availability: 'metadata-required' })
    expect(route.metadata).toMatchObject({
      aleoAppMetadataVerified: true,
      aleoProgramSource: 'https://explorer.provable.com/program/hyp_warp_token_wbtc_v2.aleo',
      aleoAppMetadataSource: 'https://api.explorer.provable.com/v2/mainnet/program/hyp_warp_token_wbtc_v2.aleo/mapping/app_metadata/true',
      aleoAppMetadataReviewedAt: '2026-08-17',
      aleoProgramEdition: 0,
      aleoTokenType: '1',
      aleoTokenOwner: 'aleo14jauje2a5sncm9u5t3mt6qqv3eq2hatkddskccs0dvsy35a0x58q0d6f95',
      aleoIsm: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      aleoHook: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      aleoTokenId: '1505227928464760254508513036497943623956572091841806589002910775534260084309field',
      aleoRemoteRouterVerified: true,
      aleoRemoteRouterSource: 'https://api.explorer.provable.com/v2/mainnet/program/hyp_warp_token_wbtc_v2.aleo/mapping/remote_routers/1u32',
      aleoDestinationDomain: 1,
      aleoRemoteRouterEvmAddress: '0x20CDC85778b732073F7EecEF3DF25c0d310f8772',
      aleoRemoteRouterGas: '68000',
      aleoAllowanceSpendersVerified: true,
      aleoUnusedAllowancesVerified: true,
      aleoAllowanceSpender0: 'aleo194tz0jmyq8rd9htvnqppqw4jqerk2p2zd8plzn3sxl06wcgsm5pq9fka74',
      aleoAllowanceAmount1: '0',
      aleoAllowanceAmount2: '0',
      aleoAllowanceAmount3: '0',
    })
  })

  it('pins verified Aleo ETH metadata and sample transaction without activating the route', () => {
    const route = DEFAULT_BRIDGE_REGISTRY.routes.find((entry) =>
      entry.id === 'hyperlane:aleo/eth->ethereum/eth')!
    expect(route).toMatchObject({ availability: 'metadata-required' })
    expect(route.metadata).toMatchObject({
      aleoAppMetadataVerified: true,
      aleoProgramSource: 'https://explorer.provable.com/program/hyp_warp_token_eth_v2.aleo',
      aleoProgramEdition: 0,
      aleoTokenType: '1',
      aleoTokenOwner: 'aleo1wq6f6qdqya44avznygz5hae40u3mjg64w0r93a4qfu4utpf8cg9q566f4r',
      aleoTokenId: '133188123661477349522757068766864658505569365361420630212878794317749195359field',
      aleoRemoteRouterVerified: true,
      aleoRemoteRouterSource: 'https://api.explorer.provable.com/v2/mainnet/program/hyp_warp_token_eth_v2.aleo/mapping/remote_routers/1u32',
      aleoSampleTransferSource: 'https://explorer.provable.com/transaction/at1vu0yckkms887zkl3qz7plnncd56jtf5zeal4uj2808upsjkusy8q7yp9v8',
      aleoDestinationDomain: 1,
      aleoRemoteRouterEvmAddress: '0x38D447694f5c1f773ae3132cf93bF30B7Ec1Fa5A',
      aleoRemoteRouterGas: '44000',
      aleoAllowanceSpendersVerified: true,
      aleoUnusedAllowancesVerified: true,
    })
  })

  it('pins current USDT app metadata and the Ethereum router independently of the BSC sample', () => {
    const route = DEFAULT_BRIDGE_REGISTRY.routes.find((entry) =>
      entry.id === 'hyperlane:aleo/usdt->ethereum/usdt')!
    expect(route).toMatchObject({ availability: 'metadata-required' })
    expect(route.metadata).toMatchObject({
      aleoAppMetadataVerified: true,
      aleoProgramSource: 'https://explorer.provable.com/program/hyp_warp_token_usdt_v2.aleo',
      aleoProgramEdition: 1,
      aleoTokenOwner: 'aleo1l3gwacmjruxryy9c7c4fn0acyzprf29hucrvthw7f63lpyhd5y9srydq8z',
      aleoTokenId: '8295938150000417034830036849466229528602563851235385582732969109393809606969field',
      aleoLocalDecimals: 6,
      aleoRemoteDecimals: 18,
      aleoScale: '1000000000000',
      aleoRemoteRouterVerified: true,
      aleoDestinationDomain: 1,
      aleoRemoteRouterEvmAddress: '0x3C2064D78e4578E8F936E3db42aEF044E33FBF31',
      aleoRemoteRouterGas: '68000',
      aleoSampleTransferSource: 'https://explorer.provable.com/transaction/at19caeeee8v3xc4kfwen4tx89f0tnggrpjp0anrhq2ca3y82xr9q8qyz8a9r',
      aleoSampleTransferDestinationDomain: 56,
      aleoAllowanceSpendersVerified: true,
      aleoUnusedAllowancesVerified: true,
    })
  })

  it('pins current SOL metadata and the Solana router without activating withdrawals', () => {
    const route = DEFAULT_BRIDGE_REGISTRY.routes.find((entry) =>
      entry.id === 'hyperlane:aleo/sol->solana/sol')!
    expect(route).toMatchObject({ availability: 'metadata-required' })
    expect(route.metadata).toMatchObject({
      aleoAppMetadataVerified: true,
      aleoProgramSource: 'https://explorer.provable.com/program/hyp_warp_token_sol_v2.aleo',
      aleoProgramEdition: 0,
      aleoTokenOwner: 'aleo1wr8rfr4ggedjxtg5e23s38zqkgy2j05uc9l8t4akjp5zcw3levpswkwk45',
      aleoTokenId: '6148061383892805373029428966764338809222769879628268522058032128225601478383field',
      aleoLocalDecimals: 9,
      aleoRemoteDecimals: 9,
      aleoRemoteRouterVerified: true,
      aleoDestinationDomain: 1399811149,
      aleoRemoteRouterSolanaAddress: '8YGT2pZwyZe94qBpGzWfY2TMEVcwaQ1bXAE7YAgpUaM7',
      aleoRemoteRouterGas: '300000',
      aleoSampleTransitionId: 'au15fg39h53h55tkj0nexrme3k6pvgxngxapcyajdhf06jcg3cyeugq5kd7hg',
      aleoAllowanceSpendersVerified: true,
      aleoUnusedAllowancesVerified: true,
    })
    expect(DEFAULT_BRIDGE_REGISTRY.chains.find((chain) => chain.id === 'solana')?.protocolDomains?.hyperlane)
      .toBe(1399811149)
    expect(DEFAULT_BRIDGE_REGISTRY.assets.find((asset) => asset.id === 'aleo/sol')?.locator)
      .toMatchObject({
        value: 'hyp_warp_token_sol_v2.aleo',
        tokenId: 'aleo1aa0zt0vg9uwknekpqeefkvad55swp7833wc5crp2prv0lm4djuxs5r7k6v',
      })
  })

  it('shares verified Aleo mailbox metadata across every Hyperlane route', () => {
    const routes = DEFAULT_BRIDGE_REGISTRY.routes.filter((route) => route.protocol === 'hyperlane')
    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) {
      expect(route.metadata).toMatchObject({
        aleoMailboxStateVerified: true,
        aleoMailboxProgram: 'hyp_mailbox.aleo',
        aleoMailboxProgramEdition: 0,
        aleoMailboxLocalDomain: 1634493807,
        aleoMailboxObservedNonce: 170,
        aleoMailboxObservedProcessCount: 291,
        aleoMailboxDefaultIsm: 'aleo1yvf5kcsdgnescqq2lar83mms79yh3ugvc3y0mdnlgvx4lyh5zugqr9hptk',
        aleoMailboxDefaultHook: 'aleo194tz0jmyq8rd9htvnqppqw4jqerk2p2zd8plzn3sxl06wcgsm5pq9fka74',
        aleoMailboxRequiredHook: 'aleo1yxevh9qgxehej46j7vueplwjcpfdfml2dje3ey4ukzknx7wzasgqnxgq82',
        aleoMailboxDispatchProxy: 'aleo1sge9kmjzs3d8fqrscy4hwn7vf9vw4jcxe877lv0m2w8hay78lsxsqg975s',
        aleoMailboxOwner: 'aleo1ypf8xgvz560ukw25hufj3d77gx69pdcy70nssdfdxd97j80d7cqs98d7x8',
      })
    }
  })
})

describe('validateBridgeRegistry', () => {
  it('rejects dangling asset references', () => {
    expect(() => validateBridgeRegistry({
      ...DEFAULT_BRIDGE_REGISTRY,
      routes: [{
        ...DEFAULT_BRIDGE_REGISTRY.routes[0]!,
        sourceAssetId: 'missing/asset',
      }],
    })).toThrow(BridgeError)
  })

  it('rejects duplicate route ids', () => {
    const route = DEFAULT_BRIDGE_REGISTRY.routes[0]!
    expect(() => validateBridgeRegistry({
      ...DEFAULT_BRIDGE_REGISTRY,
      routes: [route, route],
    })).toThrow(/Duplicate bridge route id/)
  })

  it('rejects malformed address validation expressions', () => {
    expect(() => validateBridgeRegistry({
      ...DEFAULT_BRIDGE_REGISTRY,
      assets: [{ ...DEFAULT_BRIDGE_REGISTRY.assets[0]!, addressValidationRegex: '[' }],
      routes: [],
    })).toThrow(/invalid address validation regex/)
  })
})
