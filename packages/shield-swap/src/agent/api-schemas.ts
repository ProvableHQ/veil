import type { AgentToolSchema } from '@provablehq/veil-core/agent'

// Shared field definitions keep endpoint units and optional defaults consistent.
const poolKey = { type: 'string', description: 'Pool key as an Aleo field literal.' }
const tokenId = { type: 'string', description: 'Token id as an Aleo field literal.' }
const address = { type: 'string', description: 'Aleo address (aleo1…).' }
const pagination = {
  limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size, 1–100. Omitted uses the server default.' },
  offset: { type: 'integer', minimum: 0, description: 'Number of entries to skip. Omitted uses the server default.' },
}
const window = { type: 'string', enum: ['1h', '1d', '1w', '1m'], description: 'Metric window: hour, day, week, or month. Omitted uses the server default.' }
const exploration = {
  window,
  sort: { type: 'string', description: 'Server-supported metric sort field. Omitted uses the server default.' },
  order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction. Omitted uses the server default.' },
  ...pagination,
  search: { type: 'string', description: 'Match symbol, name, or token address; pool listings also accept a pool key. Omitted applies no search filter.' },
}
const from = { type: 'integer', description: 'Inclusive range start, in Unix seconds.' }
const to = { type: 'integer', description: 'Exclusive range end, in Unix seconds.' }
const tick = { type: 'integer', minimum: -2147483648, maximum: 2147483647, description: 'Tick index (signed i32).' }

// All entries here call the off-chain API; chain-backed values remain separate.
function schema(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): AgentToolSchema {
  return { name: `shield_swap_${name}`, description, inputSchema: { type: 'object', properties, required } }
}

/** Declares the API pool lookup, separate from the chain-direct pool tool. */
export const getApiPoolSchema = schema('get_api_pool',
  'Read a pool with token metadata and current statistics from the off-chain DEX API. Does not read consensus state.',
  { poolKey }, ['poolKey'])

/** Declares the rolling pool-statistics API lookup. */
export const getPoolStatsSchema = schema('get_pool_stats',
  'Read rolling 24-hour pool statistics from the DEX API. Requires API authentication and access.',
  { poolKey }, ['poolKey'])

/** Declares the paginated indexed pool-trade lookup. */
export const getPoolTradesSchema = schema('get_pool_trades',
  'List indexed pool trades from the DEX API. Requires API authentication and access.',
  { poolKey, ...pagination, tradeType: { type: 'string', enum: ['mint', 'add_liquidity', 'remove_liquidity', 'burn', 'collect', 'swap'], description: 'Optional indexed event type; omitted includes all types.' } }, ['poolKey'])

/** Declares the pool-candle API lookup with explicit price orientation. */
export const getPoolOhlcvSchema = schema('get_pool_ohlcv',
  'Read OHLCV candles and a summary from the DEX API over a Unix-second range. Raw prices are token1 per token0; display orientation may invert them. Requires API authentication and access.',
  {
    poolKey,
    granularity: { type: 'string', enum: ['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d'], description: 'Candle bucket duration.' },
    from, to,
    summaryFrom: { type: 'integer', description: 'Optional exact summary start in Unix seconds, at or after from and before to. Omitted uses the candle range start.' },
    orientation: { type: 'string', enum: ['raw', 'display'], default: 'raw', description: 'Price orientation. Defaults to raw (token1 per token0); display uses the pool display orientation.' },
  }, ['poolKey', 'granularity', 'from', 'to'])

/** Declares the authenticated account's indexed API position listing. */
export const getApiPositionsSchema = schema('get_api_positions',
  'List the authenticated account’s indexed liquidity positions from the DEX API. May lag chain state; use shield_swap_get_owned_positions for positions derived from owned records. Requires API authentication and access.', pagination)

/** Declares the API fee-tier registry lookup. */
export const getFeeTiersSchema = schema('get_fee_tiers',
  'List registered fee tiers and tick spacings from the DEX API. Fees are in pips (3000 = 0.30%). Requires API authentication and access.')

/** Declares the indexed initialized-tick lookup. */
export const getInitializedTicksSchema = schema('get_initialized_ticks',
  'List a pool’s indexed initialized ticks in ascending order from the DEX API. Tick indices are i32; this index may lag recently minted positions. Requires API authentication and access.',
  { poolKey }, ['poolKey'])

/** Declares a single faucet-job status read without submitting transfers. */
export const getAirdropStatusSchema = schema('get_airdrop_status',
  'Read one testnet faucet job’s current status and per-token transfer results from the DEX API. Performs one read without waiting for completion or submitting transfers. Requires API authentication and access.',
  { jobId: { type: 'string', description: 'Job id returned by shield_swap_airdrop.' } }, ['jobId'])

/** Declares the non-admin pool diagnostic API lookup. */
export const debugPoolSchema = schema('debug_pool',
  'Read pool diagnostics and optionally verify selected ticks through the DEX API. Requires API authentication and access; does not modify the pool.',
  { poolKey, ticks: { type: 'string', description: 'Optional comma-separated i32 tick indices, e.g. "-60,60". Omitted uses the server’s default diagnostics.' } }, ['poolKey'])

/** Declares the short-lived WebSocket connection-ticket request. */
export const getWebSocketTicketSchema = schema('get_websocket_ticket',
  'Request a short-lived DEX WebSocket connection ticket using the current API authentication. Returns the ticket token explicitly so a WebSocket client can connect; treat it as a credential. Does not open a connection.')

/** Declares the authenticated account's referral-code lookup. */
export const getMyReferralCodeSchema = schema('get_my_referral_code',
  'Read the authenticated account’s own referral code from the DEX API, issuing a personal code server-side if none exists and issuance is enabled. Requires a session; does not generate admin referral codes.')

/** Declares the indexed global compliance configuration lookup. */
export const getComplianceConfigSchema = schema('get_compliance_config',
  'Read global compliance configuration from the DEX API. Advisory indexed data; chain controls determine whether a transaction can finalize.')

/** Declares the indexed token compliance lookup. */
export const getTokenComplianceSchema = schema('get_token_compliance',
  'Read a token’s compliance status from the DEX API. Advisory indexed data; chain controls determine whether a transaction can finalize.',
  { tokenId }, ['tokenId'])

/** Declares the indexed token-pair compliance lookup. */
export const getPairComplianceSchema = schema('get_pair_compliance',
  'Read a token pair’s compliance status from the DEX API. Advisory indexed data; chain controls determine whether a transaction can finalize.',
  { token0: tokenId, token1: tokenId }, ['token0', 'token1'])

/** Declares the searchable pool-explorer API listing. */
export const getExplorePoolsSchema = schema('get_explore_pools',
  'Browse indexed pools and metric summaries through the DEX API with sorting, search, and pagination.', exploration)

/** Declares the searchable token-explorer API listing. */
export const getExploreTokensSchema = schema('get_explore_tokens',
  'Browse indexed tokens and metric summaries through the DEX API with sorting, search, and pagination.', exploration)

/** Declares the explorer detail lookup for one token. */
export const getExploreTokenSchema = schema('get_explore_token',
  'Read explorer metadata and metrics for an indexed token through the DEX API.',
  { tokenId: { type: 'string', description: 'Indexed token address.' }, window }, ['tokenId'])

/** Declares the cursor-paginated explorer transaction feed. */
export const getExploreTransactionsSchema = schema('get_explore_transactions',
  'Read the indexed transaction feed through the DEX API. Optional filters narrow the feed; cursor continues a previous response.',
  {
    window,
    type: { type: 'string', enum: ['swap', 'mint', 'burn'], description: 'Optional transaction type; omitted includes all types.' },
    token: { type: 'string', description: 'Optional token symbol, name, or address filter; omitted includes all tokens.' },
    pool: { type: 'string', description: 'Optional pool key filter; omitted includes all pools.' },
    cursor: { type: 'string', description: 'Optional cursor from the previous response; omitted starts at the first page.' },
    limit: pagination.limit,
  })

/** Declares the GeckoTerminal-compatible asset API lookup. */
export const getGeckoTerminalAssetSchema = schema('get_geckoterminal_asset',
  'Read GeckoTerminal-compatible asset metadata from the DEX API.',
  { id: { type: 'string', description: 'Asset identifier accepted by the DEX API.' } }, ['id'])

/** Declares the GeckoTerminal-compatible pair API lookup. */
export const getGeckoTerminalPairSchema = schema('get_geckoterminal_pair',
  'Read GeckoTerminal-compatible pair metadata from the DEX API.',
  { id: { type: 'string', description: 'Pair identifier accepted by the DEX API.' } }, ['id'])

/** Declares the GeckoTerminal-compatible block-range event lookup. */
export const getGeckoTerminalEventsSchema = schema('get_geckoterminal_events',
  'Read GeckoTerminal-compatible events from the DEX API for a block-height range.',
  { fromBlock: { type: 'integer', minimum: 0, description: 'Starting block height (u64 represented as a JSON number).' }, toBlock: { type: 'integer', minimum: 0, description: 'Ending block height (u64 represented as a JSON number).' } }, ['fromBlock', 'toBlock'])

/** Declares the latest GeckoTerminal-compatible indexed block lookup. */
export const getGeckoTerminalLatestBlockSchema = schema('get_geckoterminal_latest_block',
  'Read the latest indexed block in GeckoTerminal-compatible format from the DEX API.')

/** Declares the batch rolling pool-statistics API lookup. */
export const getPoolStatsBatchSchema = schema('get_pool_stats_batch',
  'Read rolling 24-hour statistics for up to 100 unique pools from the DEX API. Unknown or failed keys are omitted, so a missing key means unavailable statistics.',
  { keys: { type: 'string', description: 'Comma-separated pool keys, at most 100 unique keys.' } }, ['keys'])

/** Declares the indexed pool liquidity-distribution lookup. */
export const getPoolLiquidityDistributionSchema = schema('get_pool_liquidity_distribution',
  'Read indexed pool liquidity by tick range from the DEX API. Advisory data that may lag chain state.',
  { poolKey }, ['poolKey'])

/** Declares the pool-oracle API lookup with an optional time window. */
export const getPoolOracleSchema = schema('get_pool_oracle',
  'Read a pool’s oracle snapshot from the DEX API. Advisory data that may lag chain state.',
  { poolKey, windowSeconds: { type: 'integer', minimum: 0, maximum: 4294967295, description: 'Optional oracle window in seconds (u32). Omitted uses the server default.' } }, ['poolKey'])

/** Declares the indexed rebalance-preview API lookup. */
export const getRebalanceStateSchema = schema('get_rebalance_state',
  'Read indexed state for previewing a liquidity-position rebalance through the DEX API. Does not sign, prove, or execute a rebalance; execution must validate chain state.',
  { poolKey, tickLower: tick, tickUpper: tick, oldLiquidity: { type: 'string', description: 'Current position liquidity as an unsigned integer string (u128), without a type suffix.' }, mintTickLower: tick, mintTickUpper: tick },
  ['poolKey', 'tickLower', 'tickUpper', 'oldLiquidity', 'mintTickLower', 'mintTickUpper'])

/** Declares the indexed protocol-state snapshot API lookup. */
export const getProtocolStateSchema = schema('get_protocol_state',
  'Read the indexed protocol state snapshot from the DEX API. Optional minimum revision asks for a sufficiently recent snapshot; this is not a chain-direct read.',
  { minimumRevision: { type: 'integer', minimum: 0, description: 'Optional minimum indexed revision (i64). Omitted accepts the current snapshot.' } })

/** Declares a referral activity report that records server-side metadata. */
export const recordReferralActivitySchema = schema('record_referral_activity',
  'Record referral activity for an existing transaction in the DEX API. Writes server-side activity metadata; does not submit an on-chain transaction. Requires a session.',
  { action: { type: 'string', enum: ['create_pool'], description: 'Activity type supported by the API.' }, txId: { type: 'string', description: 'Existing Aleo transaction id.' }, metadata: { description: 'Optional JSON metadata associated with the activity. Omitted sends no metadata.' } }, ['action', 'txId'])

/** Declares an unverified referral address-batch report. */
export const recordReferralAddressBatchSchema = schema('record_referral_address_batch',
  'Record unverified referral links for multiple blinded addresses in the DEX API. Writes server-side links; authentication does not prove address control. Does not move funds. Requires a session.',
  { code: { type: 'string', description: 'Referral code for the unverified links.' }, blindedAddresses: { type: 'array', items: { type: 'string' }, description: 'Blinded Aleo addresses to associate with the code.' } }, ['code', 'blindedAddresses'])

/** Declares the non-admin check for the authenticated account's admin role. */
export const getReferralAdminStatusSchema = schema('get_referral_admin_status',
  'Check whether the current session has the referral administrator role through the DEX API. Available to non-admin accounts; grants no permissions and performs no admin mutation. Requires a session.')

/** Declares an unverified referral swap-claim attribution report. */
export const recordReferralSwapClaimSchema = schema('record_referral_swap_claim',
  'Record an unverified link between a redeemed referral code and a blinded address in the DEX API. Writes attribution metadata; does not claim a swap or move funds, and authentication does not prove address control. Requires a session.',
  { code: { type: 'string', description: 'Redeemed referral code.' }, blindedAddress: { type: 'string', description: 'Blinded Aleo address for the unverified link.' } }, ['code', 'blindedAddress'])

/** Declares the indexed route-topology API lookup. */
export const getRouteTopologySchema = schema('get_route_topology',
  'Read the routing graph from the DEX API. Does not quote or execute a swap; indexed topology may lag chain state.')

/** Declares the authenticated account's indexed unclaimed-assets lookup. */
export const getUnclaimedSchema = schema('get_unclaimed',
  'List the authenticated account’s indexed unclaimed swaps and position fees from the DEX API. Does not claim or collect; use chain reads before moving funds. Requires API authentication and access.')

/** Declares the USDC/USD valuation-history API lookup. */
export const getUsdcUsdHistorySchema = schema('get_usdc_usd_history',
  'Read USDC/USD valuation history from the DEX API over a Unix-second interval of at most 31 days.',
  { from, to: { ...to, description: 'Exclusive range end in Unix seconds; at most 31 days after from.' } }, ['from', 'to'])

/** Declares the low-level authentication challenge request. */
export const getAuthChallengeSchema = schema('get_auth_challenge',
  'Request a DEX API authentication challenge for an address. Creates server-side challenge state; does not sign it. Pass its exact message to an external signer and use shield_swap_verify_auth_challenge.',
  { address }, ['address'])

/** Declares verification of an externally signed authentication challenge. */
export const verifyAuthChallengeSchema = schema('verify_auth_challenge',
  'Verify an externally signed DEX API challenge and establish the ApiClient session. Stores credentials internally; returns public session metadata without JWT, refresh, or CSRF secrets. Does not sign locally.',
  { address, signature: { type: 'string', description: 'Aleo signature over the exact challenge message.' }, challengeId: { type: 'string', description: 'Challenge id returned by shield_swap_get_auth_challenge.' } }, ['address', 'signature', 'challengeId'])

/** Declares the current-session metadata lookup. */
export const getSessionSchema = schema('get_session',
  'Read the current DEX API session’s public identity and expiry metadata. Requires a session; credentials and CSRF secrets remain internal.')

/** Declares session refresh using the ApiClient's existing refresh credential. */
export const refreshSessionSchema = schema('refresh_session',
  'Refresh the DEX API session using its existing refresh credential and rotate stored session credentials. Returns public metadata without JWT, refresh, or CSRF secrets. Requires a prior session handshake with refresh support.')

/** Declares revocation of the current API session. */
export const logoutSchema = schema('logout',
  'Request logout of the current DEX API session and revoke its refresh session. Confirmed logout clears local credentials; an identity mismatch returns ended: false and preserves them. Subsequent session-gated tools require authentication again. Does not revoke separately provisioned API tokens.')

/** Declares revocation of all API sessions for the current account. */
export const logoutAllSchema = schema('logout_all',
  'Log out every DEX API session for the authenticated account and clear local session credentials. Other devices and agents using those sessions must authenticate again. Requires a session; separately provisioned API tokens remain independent.')

/** Declares the authenticated account's active API session listing. */
export const listSessionsSchema = schema('list_sessions',
  'List the authenticated account’s active DEX API sessions with ids, timestamps, and the current-session flag. Requires a session; returns no session credentials.')

/** Declares targeted revocation of an account-owned API session. */
export const revokeSessionSchema = schema('revoke_session',
  'Revoke one of the authenticated account’s DEX API sessions. Revoking the current session also clears local session credentials; the affected session must authenticate again. Requires a session.',
  { sessionId: { type: 'string', format: 'uuid', description: 'Session UUID from shield_swap_list_sessions.' } }, ['sessionId'])

/** Declares the opt-in testnet faucet request that submits server-funded transfers. */
export const airdropSchema = schema('airdrop',
  'Start a testnet faucet drop to an Aleo address. The server submits treasury-funded public-to-private token transfers and returns a job id; poll shield_swap_get_airdrop_status for results. Rate limited per recipient; token amounts are server-configured. Requires API authentication, access, and includeWrites.',
  { address }, ['address'])

/** Collects additional non-admin API tools that require only an ApiClient backing. */
export const additionalApiToolSchemas: AgentToolSchema[] = [
  getApiPoolSchema, getPoolStatsSchema, getPoolTradesSchema, getPoolOhlcvSchema,
  getApiPositionsSchema, getFeeTiersSchema, getInitializedTicksSchema, getAirdropStatusSchema,
  debugPoolSchema, getWebSocketTicketSchema, getMyReferralCodeSchema,
  getComplianceConfigSchema, getTokenComplianceSchema, getPairComplianceSchema,
  getExplorePoolsSchema, getExploreTokensSchema, getExploreTokenSchema, getExploreTransactionsSchema,
  getGeckoTerminalAssetSchema, getGeckoTerminalPairSchema, getGeckoTerminalEventsSchema, getGeckoTerminalLatestBlockSchema,
  getPoolStatsBatchSchema, getPoolLiquidityDistributionSchema, getPoolOracleSchema, getRebalanceStateSchema,
  getProtocolStateSchema, recordReferralActivitySchema, recordReferralAddressBatchSchema,
  getReferralAdminStatusSchema, recordReferralSwapClaimSchema, getRouteTopologySchema, getUnclaimedSchema,
  getUsdcUsdHistorySchema, getAuthChallengeSchema, verifyAuthChallengeSchema, getSessionSchema,
  refreshSessionSchema, logoutSchema, logoutAllSchema, listSessionsSchema, revokeSessionSchema,
]

/** Collects API tools that submit money-moving server transactions and require includeWrites. */
export const apiWriteToolSchemas: AgentToolSchema[] = [airdropSchema]
