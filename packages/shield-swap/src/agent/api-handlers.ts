import type { AgentToolHandler } from '@provablehq/veil-core/agent'
import type { ApiClient } from '../api/client.js'

// Session credentials must stay in the ApiClient, including legacy response fields.
function publicSession(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicSession)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/^(?:token|.*[_-]token|.*Token|csrf|jwt|cookie|cookies|authorization)$/i.test(key),
  ).map(([key, entry]) => [key, publicSession(entry)]))
}

/**
 * Binds non-admin API tools without requiring a chain client or local signer.
 *
 * Each handler calls its REST endpoint through the ApiClient. Session results
 * omit credentials; explicit API-token minting and WebSocket tickets retain
 * their purpose-specific secret outputs in their respective handlers.
 *
 * @param api API client holding the configured authentication and network transport.
 * @returns Handlers indexed by their registered tool names.
 * @example
 * const handlers = createAdditionalApiHandlers(new ApiClient())
 * await handlers.shield_swap_get_api_pool!({ poolKey: '1field' })
 */
export function createAdditionalApiHandlers(api: ApiClient): Record<string, AgentToolHandler> {
  return {
    shield_swap_get_api_pool: async (i) => api.getPool(i.poolKey as string),
    shield_swap_get_pool_stats: async (i) => api.getPool24hStats(i.poolKey as string),
    shield_swap_get_pool_trades: async (i) => api.getPoolTrades(i.poolKey as string, {
      limit: i.limit as number | undefined,
      offset: i.offset as number | undefined,
      trade_type: i.tradeType as string | undefined,
    }),
    shield_swap_get_pool_ohlcv: async (i) => api.getPoolOhlcv(i.poolKey as string, {
      granularity: i.granularity as Parameters<ApiClient['getPoolOhlcv']>[1]['granularity'],
      from: i.from as number,
      to: i.to as number,
      summary_from: i.summaryFrom as number | undefined,
      orientation: i.orientation as 'raw' | 'display' | undefined,
    }),
    shield_swap_get_api_positions: async (i) => api.getPositions({ limit: i.limit as number | undefined, offset: i.offset as number | undefined }),
    shield_swap_get_fee_tiers: async () => api.getFeeTiers(),
    shield_swap_get_initialized_ticks: async (i) => api.getInitializedTicks(i.poolKey as string),
    shield_swap_get_airdrop_status: async (i) => api.getAirdropStatus(i.jobId as string),
    shield_swap_debug_pool: async (i) => api.debugPool({ pool_key: i.poolKey as string, ticks: i.ticks as string | undefined }),
    shield_swap_get_websocket_ticket: async () => api.getWebSocketTicket(),
    shield_swap_get_my_referral_code: async () => api.getMyReferralCode(),
    shield_swap_get_compliance_config: async () => api.getComplianceConfig(),
    shield_swap_get_token_compliance: async (i) => api.getTokenCompliance(i.tokenId as string),
    shield_swap_get_pair_compliance: async (i) => api.getPairCompliance(i.token0 as string, i.token1 as string),
    shield_swap_get_explore_pools: async (i) => api.getExplorePools({
      window: i.window as string | undefined, sort: i.sort as string | undefined,
      order: i.order as string | undefined, limit: i.limit as number | undefined,
      offset: i.offset as number | undefined, search: i.search as string | undefined,
    }),
    shield_swap_get_explore_tokens: async (i) => api.getExploreTokens({
      window: i.window as string | undefined, sort: i.sort as string | undefined,
      order: i.order as string | undefined, limit: i.limit as number | undefined,
      offset: i.offset as number | undefined, search: i.search as string | undefined,
    }),
    shield_swap_get_explore_token: async (i) => api.getExploreToken(i.tokenId as string, { window: i.window as string | undefined }),
    shield_swap_get_explore_transactions: async (i) => api.getExploreTransactions({
      window: i.window as string | undefined, type: i.type as string | undefined,
      token: i.token as string | undefined, pool: i.pool as string | undefined,
      cursor: i.cursor as string | undefined, limit: i.limit as number | undefined,
    }),
    shield_swap_get_geckoterminal_asset: async (i) => api.getGeckoTerminalAsset(i.id as string),
    shield_swap_get_geckoterminal_pair: async (i) => api.getGeckoTerminalPair(i.id as string),
    shield_swap_get_geckoterminal_events: async (i) => api.getGeckoTerminalEvents({ fromBlock: i.fromBlock as number, toBlock: i.toBlock as number }),
    shield_swap_get_geckoterminal_latest_block: async () => api.getGeckoTerminalLatestBlock(),
    shield_swap_get_pool_stats_batch: async (i) => api.getPoolStatsBatch({ keys: i.keys as string }),
    shield_swap_get_pool_liquidity_distribution: async (i) => api.getPoolLiquidityDistribution(i.poolKey as string),
    shield_swap_get_pool_oracle: async (i) => api.getPoolOracle(i.poolKey as string, { window_seconds: i.windowSeconds as number | undefined }),
    shield_swap_get_rebalance_state: async (i) => api.getRebalanceState(i.poolKey as string, {
      tick_lower: i.tickLower as number, tick_upper: i.tickUpper as number,
      old_liquidity: i.oldLiquidity as string,
      mint_tick_lower: i.mintTickLower as number, mint_tick_upper: i.mintTickUpper as number,
    }),
    shield_swap_get_protocol_state: async (i) => api.getProtocolState({ minimum_revision: i.minimumRevision as number | undefined }),
    shield_swap_record_referral_activity: async (i) => api.recordReferralActivity({
      action: i.action as Parameters<ApiClient['recordReferralActivity']>[0]['action'],
      tx_id: i.txId as string,
      ...(i.metadata !== undefined ? { metadata: i.metadata } : {}),
    }),
    shield_swap_record_referral_address_batch: async (i) => api.recordReferralAddressBatch({ code: i.code as string, blinded_addresses: i.blindedAddresses as string[] }),
    shield_swap_get_referral_admin_status: async () => api.getReferralAdminStatus(),
    shield_swap_record_referral_swap_claim: async (i) => api.recordReferralSwapClaim({ code: i.code as string, blinded_address: i.blindedAddress as string }),
    shield_swap_get_route_topology: async () => api.getRouteTopology(),
    shield_swap_get_unclaimed: async () => api.getUnclaimed(),
    shield_swap_get_usdc_usd_history: async (i) => api.getUsdcUsdHistory({ from: i.from as number, to: i.to as number }),
    shield_swap_get_auth_challenge: async (i) => api.getAuthChallenge({ address: i.address as string }),
    shield_swap_verify_auth_challenge: async (i) => publicSession(await api.verifyAuthChallenge({
      address: i.address as string, signature: i.signature as string, challenge_id: i.challengeId as string,
    })),
    shield_swap_get_session: async () => publicSession(await api.getSession()),
    shield_swap_refresh_session: async () => publicSession(await api.refreshSession()),
    shield_swap_logout: async () => api.logout(),
    shield_swap_logout_all: async () => api.logoutAll(),
    shield_swap_list_sessions: async () => publicSession(await api.listSessions()),
    shield_swap_revoke_session: async (i) => api.revokeSession(i.sessionId as string),
  }
}

/**
 * Binds API tools that submit server-side token transfers.
 *
 * @param api API client whose authentication authorizes faucet requests.
 * @returns Money-moving API handlers; register only when includeWrites is enabled.
 * @example
 * const handlers = createApiWriteHandlers(new ApiClient({ apiToken: 'ss_provisioned' }))
 * await handlers.shield_swap_airdrop!({ address: 'aleo1recipient' })
 */
export function createApiWriteHandlers(api: ApiClient): Record<string, AgentToolHandler> {
  return { shield_swap_airdrop: async (i) => api.airdrop(i.address as string) }
}
