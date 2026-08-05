import type { Client } from '@provablehq/veil-core'
import { getPool, type GetPoolParameters, type GetPoolReturnType } from '../actions/reads/getPool.js'
import { getSlot, type GetSlotParameters, type GetSlotReturnType } from '../actions/reads/getSlot.js'
import {
  getSwapOutput,
  type GetSwapOutputParameters,
  type GetSwapOutputReturnType,
} from '../actions/reads/getSwapOutput.js'
import { isBlindedAddressUsed } from '../actions/reads/isBlindedAddressUsed.js'
import { isPoolInitialized } from '../actions/reads/isPoolInitialized.js'
import { isFeeTierValid } from '../actions/reads/isFeeTierValid.js'
import { isTickSpacingValid } from '../actions/reads/isTickSpacingValid.js'
import { getFeeToTickSpacing } from '../actions/reads/getFeeToTickSpacing.js'
import {
  getPosition,
  type GetPositionParameters,
  type GetPositionReturnType,
} from '../actions/reads/getPosition.js'
import { getTick, type GetTickParameters, type GetTickReturnType } from '../actions/reads/getTick.js'
import {
  getOwnedPositions,
  type GetOwnedPositionsParameters,
  type GetOwnedPositionsReturnType,
} from '../actions/reads/getOwnedPositions.js'
import {
  getOwnedPosition,
  type GetOwnedPositionParameters,
  type GetOwnedPositionReturnType,
} from '../actions/reads/getOwnedPosition.js'
import { isGlobalPaused } from '../actions/reads/isGlobalPaused.js'
import { isPoolCreationOpen } from '../actions/reads/isPoolCreationOpen.js'
import { isTokenAllowed } from '../actions/reads/isTokenAllowed.js'
import { isTokenPaused } from '../actions/reads/isTokenPaused.js'
import { isPairPaused } from '../actions/reads/isPairPaused.js'
import { getFrozenPosition } from '../actions/reads/getFrozenPosition.js'
import {
  getTradeControls,
  type GetTradeControlsReturnType,
} from '../actions/reads/getTradeControls.js'
import { swap, type SwapParameters, type SwapReturnType } from '../actions/swap/swap.js'
import {
  claimSwapOutput,
  type ClaimSwapOutputParameters,
  type ClaimSwapOutputReturnType,
} from '../actions/swap/claimSwapOutput.js'
import {
  swapMultiHop,
  type SwapMultiHopParameters,
  type SwapMultiHopReturnType,
} from '../actions/swap/swapMultiHop.js'
import { createPool, type CreatePoolParameters, type CreatePoolReturnType } from '../actions/liquidity/createPool.js'
import { mint, type MintParameters, type MintReturnType } from '../actions/liquidity/mint.js'
import {
  increaseLiquidity,
  type IncreaseLiquidityParameters,
  type IncreaseLiquidityReturnType,
} from '../actions/liquidity/increaseLiquidity.js'
import {
  decreaseLiquidity,
  type DecreaseLiquidityParameters,
  type DecreaseLiquidityReturnType,
} from '../actions/liquidity/decreaseLiquidity.js'
import { collect, type CollectParameters, type CollectReturnType } from '../actions/liquidity/collect.js'
import { burn, type BurnParameters, type BurnReturnType } from '../actions/liquidity/burn.js'
import {
  getPrivateBalances,
  type GetPrivateBalancesParameters,
  type GetPrivateBalancesReturnType,
} from '../utils/records.js'
import { getBalances, type GetBalancesParameters, type GetBalancesReturnType } from '../utils/balances.js'
import { pickInsertHint, type PickInsertHintParameters } from '../utils/tick-hints.js'
import { resolveDexImports, type ResolveDexImportsParameters } from '../utils/imports.js'
import { resolveToken, listTokens, type TokenInfo } from '../utils/tokens.js'
import { reserveBlindedIdentity } from '../actions/blinding/reserveBlindedIdentity.js'
import { syncBlindedIdentities } from '../actions/blinding/syncBlindedIdentities.js'
import { recordBlindedSwap, type RecordBlindedSwapParameters } from '../actions/blinding/recordBlindedSwap.js'
import {
  getUnclaimedSwaps,
  type GetUnclaimedSwapsParameters,
  type GetUnclaimedSwapsReturnType,
} from '../actions/blinding/getUnclaimedSwaps.js'
import {
  reconcileSwapHistory,
  type ReconcileSwapHistoryParameters,
  type ReconcileSwapHistoryReturnType,
} from '../actions/blinding/reconcileSwapHistory.js'
import {
  memoryBlindedIdentityStore,
  type BlindedIdentityRecord,
  type BlindedIdentityStore,
} from '../utils/blinding/store.js'
import { ApiClient, authenticateWithAccount, defaultApiUrl, type ApiClientOptions } from '../api/client.js'

/**
 * Configuration for {@link shieldSwapActions}.
 *
 * @property api Off-chain DEX API wiring: constructor options, a
 *   preconstructed `ApiClient` (e.g. one already holding a JWT), or
 *   omitted for a chain-only client whose `.api` throws on first use.
 * @property program shield_swap program id every action defaults to. Set it
 *   once to point the whole surface at another deployment; per-call
 *   `program` still overrides.
 * @property blindedIdentities Where identities are reserved and swaps recorded,
 *   used by `reserveBlindedIdentity` and by `swap`, `swapMultiHop`, and
 *   `claimSwapOutput`. Defaults to a per-client in-memory store, so concurrent
 *   swaps through one client are safe out of the box; that store is lost on
 *   restart, which costs a chain rescan for the next counter and forgets any
 *   unclaimed swap, so pass `fileBlindedIdentityStore` from
 *   `@provablehq/shield-swap-sdk/node` for anything long-running. Ignored by
 *   wallet accounts, which derive identities the client never sees. A per-call
 *   `blindedIdentities: undefined` opts that call out of tracking entirely.
 */
export type ShieldSwapActionsConfig = {
  api?: ApiClientOptions | ApiClient
  program?: string
  blindedIdentities?: BlindedIdentityStore
}

/**
 * The action surface {@link shieldSwapActions} adds to a client.
 *
 * @property resolveDexImports Builds the `imports` map a write needs — the
 *   given token programs plus the DEX program's own declared imports. Every
 *   write action's `imports` parameter takes the result directly. Hits the
 *   network once per unique program.
 * @property resolveToken Resolves a token by symbol or id against the client's
 *   network, so a caller can take `USDCx` from a person and hand an id to an
 *   action. Cached per client after the first call.
 * @property listTokens The network's token registry, cached per client.
 * @property reserveBlindedIdentity Reserves the next unused blinded identity
 *   from the configured store and returns it for a swap's `blindedIdentity`.
 *   Required for concurrent swaps from one local account: deriving per swap
 *   from a chain read alone hands two swaps the same address and the second
 *   reverts on finalize. Local accounts only.
 * @property recordBlindedSwap Attaches a swap and its handle to the reservation
 *   that funded it, which is what lets
 *   {@link ShieldSwapActions.syncBlindedIdentities} tell a swapped identity from
 *   a claimed one and what makes the swap claimable from the store later.
 *   Resolves `false` when the store holds no reservation for the handle's
 *   address, as a wallet-derived identity does not. Store write, no network.
 * @property syncBlindedIdentities Reconciles stored reservations against the
 *   chain, promoting each to `swapped` or `claimed` once its blinded address
 *   appears on chain. Hits the network per unsettled record.
 * @property getUnclaimedSwaps Summarizes what this store's identities can still
 *   claim, reading `swap_outputs` rather than trusting stored statuses, with
 *   per-token totals and a rebuilt handle per entry so a claim can be made from
 *   the store alone. One mapping read per unsettled identity; writes nothing.
 * @property reconcileSwapHistory Walks the program's `claim_swap_output` history
 *   to recover which stored identities have already been claimed, and the swap
 *   ids and amounts involved. Expensive — one request per page plus one per
 *   claim call — so run it on first adopting a store, not periodically.
 * @property authenticateShieldSwap Authenticates the `.api` client by signing
 *   its challenge with the client's account. Most DEX API endpoints are
 *   bearer-gated; call once per session — the JWT lasts ~24h and renews
 *   automatically on expiry — or skip it by configuring the api with a
 *   long-lived `apiToken`. Hits the network (challenge + verify) and signs.
 *   Returns the session JWT for callers that persist it; rejects when the
 *   client has no account.
 * @property authenticateApi Deprecated alias for
 *   {@link ShieldSwapActions.authenticateShieldSwap}.
 * @property api The off-chain DEX API client; throws on first use when no
 *   `api` was configured.
 */
export type ShieldSwapActions = {
  getPool: (params: GetPoolParameters) => Promise<GetPoolReturnType>
  getSlot: (params: GetSlotParameters) => Promise<GetSlotReturnType>
  getSwapOutput: (params: GetSwapOutputParameters) => Promise<GetSwapOutputReturnType>
  getPosition: (params: GetPositionParameters) => Promise<GetPositionReturnType>
  getOwnedPositions: (params?: GetOwnedPositionsParameters) => Promise<GetOwnedPositionsReturnType>
  getOwnedPosition: (params: GetOwnedPositionParameters) => Promise<GetOwnedPositionReturnType>
  getTick: (params: GetTickParameters) => Promise<GetTickReturnType>
  isBlindedAddressUsed: (params: { address: string; program?: string }) => Promise<boolean>
  isPoolInitialized: (params: { poolKey: string; program?: string }) => Promise<boolean>
  isFeeTierValid: (params: { fee: number; program?: string }) => Promise<boolean>
  isTickSpacingValid: (params: { tickSpacing: number; program?: string }) => Promise<boolean>
  getFeeToTickSpacing: (params: { fee: number; program?: string }) => Promise<number | null>
  isGlobalPaused: (params?: { program?: string }) => Promise<boolean>
  isPoolCreationOpen: (params?: { program?: string }) => Promise<boolean>
  isTokenAllowed: (params: { tokenId: string; program?: string }) => Promise<boolean>
  isTokenPaused: (params: { tokenId: string; program?: string }) => Promise<boolean>
  isPairPaused: (params: { token0: string; token1: string; program?: string }) => Promise<boolean>
  getFrozenPosition: (params: { positionTokenId: string; program?: string }) => Promise<number | null>
  getTradeControls: (params: { poolKey: string; program?: string }) => Promise<GetTradeControlsReturnType>
  getPrivateBalances: (params: GetPrivateBalancesParameters) => Promise<GetPrivateBalancesReturnType>
  getBalances: (params?: GetBalancesParameters) => Promise<GetBalancesReturnType>
  pickInsertHint: (params: PickInsertHintParameters) => Promise<number>
  resolveDexImports: (params: ResolveDexImportsParameters) => Promise<Record<string, string>>
  resolveToken: (symbolOrId: string) => Promise<TokenInfo>
  listTokens: () => Promise<TokenInfo[]>
  reserveBlindedIdentity: (params?: { program?: string; maxScan?: number }) => Promise<BlindedIdentityRecord>
  recordBlindedSwap: (params: RecordBlindedSwapParameters) => Promise<boolean>
  syncBlindedIdentities: (params?: { program?: string }) => Promise<BlindedIdentityRecord[]>
  reconcileSwapHistory: (
    params?: Omit<ReconcileSwapHistoryParameters, 'store'>,
  ) => Promise<ReconcileSwapHistoryReturnType>
  getUnclaimedSwaps: (
    params?: Omit<GetUnclaimedSwapsParameters, 'store'>,
  ) => Promise<GetUnclaimedSwapsReturnType>
  swap: (params: SwapParameters) => Promise<SwapReturnType>
  claimSwapOutput: (params: ClaimSwapOutputParameters) => Promise<ClaimSwapOutputReturnType>
  swapMultiHop: (params: SwapMultiHopParameters) => Promise<SwapMultiHopReturnType>
  createPool: (params: CreatePoolParameters) => Promise<CreatePoolReturnType>
  mint: (params: MintParameters) => Promise<MintReturnType>
  increaseLiquidity: (params: IncreaseLiquidityParameters) => Promise<IncreaseLiquidityReturnType>
  decreaseLiquidity: (params: DecreaseLiquidityParameters) => Promise<DecreaseLiquidityReturnType>
  collect: (params: CollectParameters) => Promise<CollectReturnType>
  burn: (params: BurnParameters) => Promise<BurnReturnType>
  authenticateShieldSwap: () => Promise<string>
  /**
   * @deprecated Renamed to `authenticateShieldSwap`, which names the service it
   *   signs into — a client can also carry `authenticateProvableApi`, and "the
   *   API" does not say which one. Behaviour is identical. Removed in the next
   *   major.
   */
  authenticateApi: () => Promise<string>
  api: ApiClient
}

/**
 * Builds the DEX decorator for `client.extend()`.
 *
 * One surface, two provenances: chain-direct reads and writes sit flat on
 * the client (consensus-backed — the money path); the off-chain DEX API's
 * REST methods live under `.api`, so a call site always shows which world a
 * value came from. Omit `api` for a chain-only client.
 *
 * @param config DEX API wiring and the default program.
 * @returns A decorator: pass it to `client.extend(...)`.
 *
 * @example
 * const client = createWalletClient({ account, transport, proving })
 *   .extend(shieldSwapActions({ api: {} }))
 * const pool = await client.getPool({ poolKey })   // chain
 * const pools = await client.api.getPools()        // REST
 */
export function shieldSwapActions(config: ShieldSwapActionsConfig = {}) {
  /**
   * Builds the API client for a specific chain client.
   *
   * Deferred until the decorator receives its client, because the DEX API is
   * deployed per-network on separate hosts and only the client knows which
   * network it reads. Resolved per request, so `switchChain` re-targets the API
   * rather than leaving it on the network the client started from. An explicit
   * `baseUrl` still wins.
   */
  const buildApi = (client: Client): ApiClient | undefined => {
    if (config.api instanceof ApiClient) return config.api
    if (!config.api) return undefined
    return new ApiClient({
      ...config.api,
      // Applied after the spread and coalesced, so only a baseUrl that is
      // actually set overrides the derived host. Spreading `config.api` last
      // would let an explicit-but-undefined `baseUrl` — `process.env.X` with X
      // unset — win, and the ApiClient would fall back to its deprecated
      // testnet constant, silently pointing a mainnet client at testnet.
      baseUrl: config.api.baseUrl ?? (() => defaultApiUrl(client.transport.config.network)),
    })
  }

  // Thread the client-level program default under any per-call override.
  const withProgram = <P extends { program?: string }>(p: P): P => ({ ...p, program: p.program ?? config.program })

  // One store per decorator, shared by every client it extends: reservations
  // are per account, and a store built per client would let two clients on the
  // same key hand out the same counter.
  const blindedIdentities = config.blindedIdentities ?? memoryBlindedIdentityStore()

  // `extend()` copies properties with Object.assign, which evaluates getters
  // eagerly — so the "no api" case is a proxy that throws actionably on
  // first USE instead of a lazy getter (which would throw at extend time).
  const missingApi = new Proxy({} as ApiClient, {
    get() {
      throw new Error(
        'No DEX API configured — pass shieldSwapActions({ api: { baseUrl } }) or construct an ApiClient yourself.',
      )
    },
  })

  return (client: Client): ShieldSwapActions => {
    const api = buildApi(client)
    // Supplied to every hint-deriving action so a caller without the WASM peer
    // gets the exact predecessor from the API's tick list rather than a
    // best-effort guess from the slot. Only consulted on that path, so a client
    // with the peer never pays the request.
    // The configured store, threaded to the actions that track identities.
    // Presence rather than truthiness: a caller who writes
    // `blindedIdentities: undefined` is opting out of tracking for that call, and
    // a truthy test would inject the default over the top of that intent. Absent
    // key means "not specified", which is what takes the default.
    const withStore = <P extends { blindedIdentities?: BlindedIdentityStore }>(p: P): P =>
      'blindedIdentities' in p ? p : { ...p, blindedIdentities }

    const withTicks = <P extends { poolKey: string; initializedTicks?: unknown }>(p: P): P => {
      if (p.initializedTicks || !api) return p
      // Shared across the action's hints rather than fetched per hint: `mint`
      // derives two and would otherwise request the same list twice. A rejection
      // is cached with it, so both hints fall back to the slot together instead
      // of disagreeing about their source.
      let inFlight: Promise<number[]> | undefined
      return {
        ...p,
        initializedTicks: () =>
          (inFlight ??= api.getInitializedTicks(p.poolKey).then((r) => r.data ?? [])),
      }
    }
    return {
      getPool: (p) => getPool(client, withProgram(p)),
      getSlot: (p) => getSlot(client, withProgram(p)),
      getSwapOutput: (p) => getSwapOutput(client, withProgram(p)),
      getPosition: (p) => getPosition(client, withProgram(p)),
      getOwnedPositions: (p) => getOwnedPositions(client, withProgram(p ?? {})),
      getOwnedPosition: (p) => getOwnedPosition(client, withProgram(p)),
      getTick: (p) => getTick(client, withProgram(p) as GetTickParameters),
      isBlindedAddressUsed: (p) => isBlindedAddressUsed(client, withProgram(p)),
      isPoolInitialized: (p) => isPoolInitialized(client, withProgram(p)),
      isFeeTierValid: (p) => isFeeTierValid(client, withProgram(p)),
      isTickSpacingValid: (p) => isTickSpacingValid(client, withProgram(p)),
      getFeeToTickSpacing: (p) => getFeeToTickSpacing(client, withProgram(p)),
      isGlobalPaused: (p) => isGlobalPaused(client, withProgram(p ?? {})),
      isPoolCreationOpen: (p) => isPoolCreationOpen(client, withProgram(p ?? {})),
      isTokenAllowed: (p) => isTokenAllowed(client, withProgram(p)),
      isTokenPaused: (p) => isTokenPaused(client, withProgram(p)),
      isPairPaused: (p) => isPairPaused(client, withProgram(p)),
      getFrozenPosition: (p) => getFrozenPosition(client, withProgram(p)),
      getTradeControls: (p) => getTradeControls(client, withProgram(p)),
      getPrivateBalances: (p) => getPrivateBalances(client, p),
      getBalances: (p) => getBalances(client, api ?? missingApi, p),
      pickInsertHint: (p) => pickInsertHint(client, withTicks(withProgram(p))),
      resolveDexImports: (p) => resolveDexImports(client, withProgram(p)),
      resolveToken: (symbolOrId) => resolveToken(api ?? missingApi, symbolOrId),
      listTokens: () => listTokens(api ?? missingApi),
      reserveBlindedIdentity: (p) =>
        reserveBlindedIdentity(client, { ...withProgram(p ?? {}), store: blindedIdentities }),
      recordBlindedSwap: (p) => recordBlindedSwap(blindedIdentities, p),
      syncBlindedIdentities: (p) =>
        syncBlindedIdentities(client, { ...withProgram(p ?? {}), store: blindedIdentities }),
      reconcileSwapHistory: (p) =>
        reconcileSwapHistory(client, { ...withProgram(p ?? {}), store: blindedIdentities }),
      getUnclaimedSwaps: (p) =>
        getUnclaimedSwaps(client, { ...withProgram(p ?? {}), store: blindedIdentities }),
      swap: (p) => swap(client, withStore(withProgram(p))),
      claimSwapOutput: (p) => claimSwapOutput(client, withStore(p)),
      swapMultiHop: (p) => swapMultiHop(client, withStore(withProgram(p))),
      createPool: (p) => createPool(client, withProgram(p)),
      mint: (p) => mint(client, withTicks(withProgram(p))),
      increaseLiquidity: (p) => increaseLiquidity(client, withTicks(withProgram(p))),
      decreaseLiquidity: (p) => decreaseLiquidity(client, withProgram(p)),
      collect: (p) => collect(client, withProgram(p)),
      burn: (p) => burn(client, withProgram(p)),
      authenticateShieldSwap: () => authenticateWithAccount(api ?? missingApi, client.account),
      // Same function, not a wrapper: the two names must not drift while the
      // deprecated one is still supported.
      authenticateApi: () => authenticateWithAccount(api ?? missingApi, client.account),
        api: api ?? missingApi,
    }
  }
}
