import { describe, expect, it } from 'vitest'
import spec from '../../codegen/amm-api/amm-api.json'
import { ApiClient } from '../../src/api/client.js'

// This inventory is independent of the implementation: a newly pinned public
// endpoint must receive a callable SDK action before coverage can pass.
const actions = {
  'POST /auth/challenge': 'getAuthChallenge',
  'POST /auth/verify': 'verifyAuthChallenge',
  'GET /auth/session': 'getSession',
  'POST /auth/refresh': 'refreshSession',
  'POST /auth/logout': 'logout',
  'POST /auth/logout-all': 'logoutAll',
  'GET /auth/sessions': 'listSessions',
  'POST /auth/sessions/{session_id}/revoke': 'revokeSession',
  'GET /auth/ws-ticket': 'getWebSocketTicket',
  'GET /api-tokens': 'listApiTokens',
  'POST /api-tokens': 'createApiToken',
  'DELETE /api-tokens/{id}': 'revokeApiToken',
  'GET /referral/status': 'getReferralStatus',
  'POST /referral/redeem': 'redeemReferralCode',
  'GET /referral/my-code': 'getMyReferralCode',
  'GET /referral/admin': 'getReferralAdminStatus',
  'POST /referral/activity': 'recordReferralActivity',
  'POST /referral/swap-claims': 'recordReferralSwapClaim',
  'POST /referral/address-batches': 'recordReferralAddressBatch',
  'GET /pools': 'getPools',
  'GET /pools/{key}': 'getPool',
  'GET /pools/stats': 'getPoolStatsBatch',
  'GET /pools/{key}/stats': 'getPool24hStats',
  'GET /pools/{key}/trades': 'getPoolTrades',
  'GET /pools/{key}/ohlcv': 'getPoolOhlcv',
  'GET /pools/{key}/initialized-ticks': 'getInitializedTicks',
  'GET /pools/{key}/liquidity-distribution': 'getPoolLiquidityDistribution',
  'GET /pools/{key}/oracle': 'getPoolOracle',
  'GET /pools/{key}/rebalance-state': 'getRebalanceState',
  'GET /positions': 'getPositions',
  'GET /tokens': 'getTokens',
  'GET /fee-tiers': 'getFeeTiers',
  'GET /route': 'getRoute',
  'GET /route/topology': 'getRouteTopology',
  'GET /protocol/state': 'getProtocolState',
  'GET /unclaimed': 'getUnclaimed',
  'GET /compliance': 'getComplianceConfig',
  'GET /compliance/tokens/{token_id}': 'getTokenCompliance',
  'GET /compliance/pairs/{token0}/{token1}': 'getPairCompliance',
  'GET /explore/pools': 'getExplorePools',
  'GET /explore/tokens': 'getExploreTokens',
  'GET /explore/tokens/{token_id}': 'getExploreToken',
  'GET /explore/transactions': 'getExploreTransactions',
  'GET /prices/usdc-usd/history': 'getUsdcUsdHistory',
  'GET /geckoterminal/asset': 'getGeckoTerminalAsset',
  'GET /geckoterminal/pair': 'getGeckoTerminalPair',
  'GET /geckoterminal/events': 'getGeckoTerminalEvents',
  'GET /geckoterminal/latest-block': 'getGeckoTerminalLatestBlock',
  'POST /airdrop': 'airdrop',
  'GET /airdrop/{job_id}': 'getAirdropStatus',
  'GET /debug/pool': 'debugPool',
} satisfies Record<string, keyof ApiClient>

describe('non-admin OpenAPI coverage', () => {
  it('maps every non-admin application endpoint to an SDK action', () => {
    const publicOperations: string[] = []
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
        const responses = operation.responses as Record<string, { description: string }>
        if (responses['403']?.description === 'Administrator authorization required') continue
        publicOperations.push(`${method.toUpperCase()} ${path}`)
      }
    }
    expect(Object.keys(actions).sort()).toEqual(publicOperations.sort())
  })

  it.each(Object.entries(actions))('%s has a callable %s action', (_operation, method) => {
    expect(typeof ApiClient.prototype[method]).toBe('function')
  })
})
