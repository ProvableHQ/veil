import type { Client } from '@veil/core'
import { getAssets } from './getAssets.js'
import { chainDisplayName, resolveChainId } from '../lib/chain-names.js'
import type { BridgeAssetSummary } from '../types/bridge.js'

/**
 * A catalog asset enriched with the client-side chain display name.
 *
 * `chainName` is derived via `chainDisplayName()` (a client-side map today;
 * the server's chain registry once `GET /common/chains` ships) — it is not a
 * wire field, so `BridgeAssetSummary` stays an honest mirror of the API
 * response.
 *
 * @property chainName Human-readable chain name (`'Base'` for `EVM:8453`);
 *   falls back to the identifier for chains the map does not know.
 */
export type RouteAsset = BridgeAssetSummary & { chainName: string }

/**
 * A candidate bridge route derived from the asset catalog: a pair of assets —
 * Aleo-side and external — that at least one provider supports on both sides.
 *
 * Candidacy means supportability, not liveness, and carries NO direction:
 * the catalog does not say whether a provider routes the pair Aleo → out,
 * in → Aleo, or both (wrapped Aleo assets often have inbound support only).
 * A `getQuotes` call for the specific direction is the confirmation step.
 *
 * @property aleoAsset The Aleo-side asset (chain `ALEO`), full catalog entry
 *   plus `chainName`.
 * @property externalAsset The other chain's asset, full catalog entry plus
 *   `chainName`.
 * @property providers Codes of the providers supporting BOTH sides
 *   (`NEAR_INTENTS`, `HALLIDAY`, …).
 */
export type BridgeRouteCandidate = {
  aleoAsset: RouteAsset
  externalAsset: RouteAsset
  providers: string[]
}

/**
 * Optional filters for `getRoutes`. All narrow the candidate set; omit
 * everything for the full graph.
 *
 * @property externalChain Only pairs whose external side is on this chain —
 *   by identifier (`'SOLANA'`, `'EVM:1'`) or display name (`'Solana'`,
 *   `'Ethereum'`), case-insensitively. An empty string means no filter.
 * @property symbol Only pairs where either side's symbol matches,
 *   case-insensitively (e.g. `'USDC'` — every place USDC can move relative
 *   to Aleo).
 * @property provider Only pairs this provider supports, by code,
 *   case-insensitively (e.g. `'NEAR_INTENTS'`).
 */
export type GetRoutesParameters = {
  externalChain?: string | undefined
  symbol?: string | undefined
  provider?: string | undefined
}

/** What `getRoutes` resolves with: one candidate per supportable pair. */
export type GetRoutesReturnType = BridgeRouteCandidate[]

/**
 * Derives the candidate route graph from the asset catalog.
 *
 * Answers "what can move where?" without prior knowledge of any asset code:
 * two assets form a candidate when a provider supports both and exactly one
 * side is on the `ALEO` chain (Aleo is always one side of a bridge pair).
 * One `getAssets` request, then pure local derivation — candidates are
 * supportability, not liquidity; confirm the pair and direction you care
 * about with `getQuotes` before showing it as available.
 *
 * @param client A client whose transport is `httpBridge`.
 * @param params Optional narrowing — see {@link GetRoutesParameters}.
 * @returns One entry per supportable pair, each self-sufficient for the
 *   follow-up quote (codes, chains, chain names, decimals, and address
 *   regexes on board).
 * @throws BridgeEnvelopeError When the catalog response is malformed.
 *
 * @example
 * // Everywhere USDC can move relative to Aleo:
 * const routes = await getRoutes(client, { symbol: 'USDC' })
 * const r = routes[0]
 * // Quote the candidate inbound:
 * const { quotes } = await getQuotes(client, {
 *   srcChain: r.externalAsset.chain, srcAsset: r.externalAsset.code,
 *   destChain: r.aleoAsset.chain, destAsset: r.aleoAsset.code,
 *   amountIn: '100', recipientAddress: aleoAddr, refundAddress: extAddr,
 * })
 */
export async function getRoutes(
  client: Client,
  params: GetRoutesParameters = {},
): Promise<GetRoutesReturnType> {
  const assets = await getAssets(client)

  // Every filter matches case-insensitively — swap and resolveAssetCode do,
  // and a silent [] from a casing mismatch is a false negative with no error
  // to correct it. Empty strings mean no filter (a UI's blank picker).
  // The chain filter goes through resolveChainId so id-or-name acceptance
  // stays in one place.
  const wantedChain = params.externalChain ? resolveChainId(params.externalChain).toLowerCase() : undefined
  const wantedSymbol = params.symbol ? params.symbol.toLowerCase() : undefined
  const wantedProvider = params.provider ? params.provider.toLowerCase() : undefined

  // Split the catalog: Aleo is always one side of a pair. Assets with no
  // provider support cannot be on any route. Provider sets are computed once
  // per asset — dedup (the catalog can list one provider twice with
  // different integration types) happens here for free.
  const supported = assets
    .filter((a) => (a.supportedProviders ?? []).length > 0)
    .map((a) => ({ asset: a, providers: new Set((a.supportedProviders ?? []).map((s) => s.providerCode)) }))
  const aleoSide = supported.filter(({ asset }) => asset.chain === 'ALEO')
  const externalSide = supported.filter(
    ({ asset }) => asset.chain !== 'ALEO' && (wantedChain == null || asset.chain.toLowerCase() === wantedChain),
  )

  const routes: BridgeRouteCandidate[] = []
  for (const { asset: aleoAsset, providers: aleoProviders } of aleoSide) {
    for (const { asset: externalAsset, providers: externalProviders } of externalSide) {
      const shared = [...externalProviders].filter((code) => aleoProviders.has(code))
      if (shared.length === 0) continue
      if (wantedProvider != null && !shared.some((code) => code.toLowerCase() === wantedProvider)) continue
      if (
        wantedSymbol != null &&
        aleoAsset.symbol.toLowerCase() !== wantedSymbol &&
        externalAsset.symbol.toLowerCase() !== wantedSymbol
      ) {
        continue
      }
      routes.push({
        aleoAsset: { ...aleoAsset, chainName: chainDisplayName(aleoAsset.chain) },
        externalAsset: { ...externalAsset, chainName: chainDisplayName(externalAsset.chain) },
        providers: shared,
      })
    }
  }
  return routes
}
