# Shield Swap API actions

`client.api` exposes the non-admin application endpoints in the Shield Swap
OpenAPI specification. The same actions are available from a standalone
`ApiClient`. Agent tools and MCP expose these actions with camelCase inputs;
the SDK translates them to the API's query parameters and request bodies.

Public market reads work without authentication. Account data and referral
activity require authentication; session management and API-token management
require a wallet session. A server may also enforce terms acceptance or access
requirements. Each method documents its authentication and side effects.

These methods read indexed or off-chain data. Use the chain actions for values
that determine spending or transaction validity.

## Endpoint coverage

| Endpoint | API action |
| --- | --- |
| `POST /auth/challenge` | `getAuthChallenge({ address })` |
| `POST /auth/verify` | `verifyAuthChallenge({ address, signature, challenge_id })` |
| `GET /auth/session` | `getSession()` |
| `POST /auth/refresh` | `refreshSession()` |
| `POST /auth/logout` | `logout()` |
| `POST /auth/logout-all` | `logoutAll()` |
| `GET /auth/sessions` | `listSessions()` |
| `POST /auth/sessions/{session_id}/revoke` | `revokeSession(sessionId)` |
| `GET /auth/ws-ticket` | `getWebSocketTicket()` |
| `GET /api-tokens` | `listApiTokens()` |
| `POST /api-tokens` | `createApiToken(body)` |
| `DELETE /api-tokens/{id}` | `revokeApiToken(id)` |
| `GET /referral/status` | `getReferralStatus()` |
| `POST /referral/redeem` | `redeemReferralCode(code)` |
| `GET /referral/my-code` | `getMyReferralCode()` |
| `GET /referral/admin` | `getReferralAdminStatus()` — checks the caller's role |
| `POST /referral/activity` | `recordReferralActivity(body)` |
| `POST /referral/swap-claims` | `recordReferralSwapClaim(body)` |
| `POST /referral/address-batches` | `recordReferralAddressBatch(body)` |
| `GET /pools` | `getPools(query?)` |
| `GET /pools/{key}` | `getPool(key)` |
| `GET /pools/stats` | `getPoolStatsBatch({ keys })` |
| `GET /pools/{key}/stats` | `getPool24hStats(key)` |
| `GET /pools/{key}/trades` | `getPoolTrades(key, query?)` |
| `GET /pools/{key}/ohlcv` | `getPoolOhlcv(key, query)` |
| `GET /pools/{key}/initialized-ticks` | `getInitializedTicks(key)` |
| `GET /pools/{key}/liquidity-distribution` | `getPoolLiquidityDistribution(key)` |
| `GET /pools/{key}/oracle` | `getPoolOracle(key, query?)` |
| `GET /pools/{key}/rebalance-state` | `getRebalanceState(key, query)` |
| `GET /positions` | `getPositions(query?)` |
| `GET /tokens` | `getTokens()` |
| `GET /fee-tiers` | `getFeeTiers()` |
| `GET /route` | `getRoute(query)` |
| `GET /route/topology` | `getRouteTopology()` |
| `GET /protocol/state` | `getProtocolState(query?)` |
| `GET /unclaimed` | `getUnclaimed()` |
| `GET /compliance` | `getComplianceConfig()` |
| `GET /compliance/tokens/{token_id}` | `getTokenCompliance(tokenId)` |
| `GET /compliance/pairs/{token0}/{token1}` | `getPairCompliance(token0, token1)` |
| `GET /explore/pools` | `getExplorePools(query?)` |
| `GET /explore/tokens` | `getExploreTokens(query?)` |
| `GET /explore/tokens/{token_id}` | `getExploreToken(tokenId, query?)` |
| `GET /explore/transactions` | `getExploreTransactions(query?)` |
| `GET /prices/usdc-usd/history` | `getUsdcUsdHistory({ from, to })` |
| `GET /geckoterminal/asset` | `getGeckoTerminalAsset(id)` |
| `GET /geckoterminal/pair` | `getGeckoTerminalPair(id)` |
| `GET /geckoterminal/events` | `getGeckoTerminalEvents({ fromBlock, toBlock })` |
| `GET /geckoterminal/latest-block` | `getGeckoTerminalLatestBlock()` |
| `POST /airdrop` | `airdrop(address)` — testnet only |
| `GET /airdrop/{job_id}` | `getAirdropStatus(jobId)` — testnet only |
| `GET /debug/pool` | `debugPool(query)` — testnet only |

Admin code generation, code inventory, referral settings, volume reports, and
administrator session revocation are excluded. Operational health and metrics
routes are outside the application OpenAPI specification.

`getPoolStats(key)` remains available for compatibility. Use `getPool24hStats`
for the accurate response type, including the `data` envelope and nullable
interval-open prices.

## Referral codes

```ts
await client.authenticateShieldSwap()
const { code } = await client.api.getMyReferralCode()
```

The personal-code endpoint returns an existing shareable code or creates one.
It can write server state even though it uses GET. The CLI keeps this action
behind `shield-swap redeem --generate --execute`.

Referral activity and blinded-address claims write attribution records. A
recorded claim does not prove ownership of a blinded address or confirm a swap.

## Sessions

`authenticate(address, sign)` combines challenge and verification for callers
with a signer. The separate challenge and verification actions support a
signature collected elsewhere. Session metadata includes CSRF information;
agent and MCP results omit authentication secrets.

Browsers using HTTP-only cookies configure `new ApiClient({ credentials:
'include' })`. `getSession()` restores session metadata. `refreshSession()`
uses the refresh cookie; an access JWT or API token alone cannot refresh a
session. Node clients retain cookies issued during verification and refresh
inside the client.

`setToken(jwt)` adopts an existing access JWT and discards the previous
session's retained refresh cookie, metadata, and signer. It cannot renew the
adopted JWT without a new authentication handshake.

`logout()` ends the current session, `revokeSession(id)` ends a selected session,
and `logoutAll()` ends every wallet session. These are explicit side effects.
Ending the current session also stops automatic signature reauthentication.
API tokens are managed separately through `revokeApiToken(id)`.

## Agent and MCP tools

```ts
import { createShieldSwapAgentTools } from '@provablehq/shield-swap-sdk/agent'

const tools = createShieldSwapAgentTools({ api: client.api })
```

API tools require an `api` instance. The signing convenience tool also requires
a `client`. Existing chain tools retain their names; API pool and position
reads are named `shield_swap_get_api_pool` and `shield_swap_get_api_positions`.
The faucet tool requires `includeWrites: true`, as do the on-chain trading
tools. Other API actions describe their own side effects in their tool schemas.

The MCP server uses the same definitions and handlers, so API actions are
available through both interfaces.
