import { transfer, type Client, type WalletClient } from '@veil/core'
import { getAssets } from './getAssets.js'
import { getQuotes } from './getQuotes.js'
import { createOrder } from './createOrder.js'
import { waitForOrder } from './waitForOrder.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import { aleoAssetProgram, type AleoAssetConfig } from '../lib/aleo-asset.js'
import { compareDecimal, parseDecimalAmount } from '../utils/units.js'
import { resolveChainId } from '../lib/chain-names.js'
import { isAssetCode, resolveAssetCode } from '../lib/asset-resolve.js'
import type { BridgeOrderStage, BridgeOrderStatusDto, BridgeQuote } from '../types/bridge.js'

/**
 * Parameters for the end-to-end Aleo-source `swap`.
 *
 * @property wallet `@veil/core` WalletClient used to sign the Aleo unshield
 *   deposit. Optional when the bridge client was built with
 *   `createBridgeClient({ wallet })` — a value here overrides the client's
 *   wallet for this call.
 * @property from Source side of the swap. `chain` is optional and defaults
 *   to `'ALEO'` — it MUST resolve to Aleo (identifier or the name `'Aleo'`),
 *   because this action signs the deposit with an Aleo wallet; a non-Aleo
 *   source throws with guidance (inbound swaps quote and order through the
 *   individual actions, with the deposit paid on the source chain). `asset`
 *   is the chain-qualified code (`ALEO_MAINNET`) or the symbol (`'ALEO'`),
 *   resolved on the Aleo chain; `amount` a decimal string in display units.
 * @property to Destination side. `chain` accepts the API's identifier
 *   (`SOLANA`, `EVM:1`) or the display name (`'Solana'`, `'Ethereum'`),
 *   case-insensitively; `asset` is the chain-qualified code
 *   (`SOL_SOLANA`, `ETH_MAINNET`); `address` is the destination-chain
 *   recipient the provider pays out to. `asset` also accepts the symbol
 *   (`'SOL'`), resolved on the destination chain.
 * @property provider Only accept quotes from this provider, by code
 *   (`'NEAR_INTENTS'`, `'HALLIDAY'`), case-insensitively. Default: any
 *   provider; the selectQuote strategy picks among all quotes. Use it to
 *   honor a user's provider choice from a getRoutes candidate — throws
 *   (before any funds move) when that provider returned no quote.
 * @property refundAddress Aleo address a failed swap refunds to. Defaults
 *   to the signing wallet's address — override when refunds should land in a
 *   different account than the one paying the deposit.
 * @property merkleProof Compliance proof, required only when the source
 *   asset's Aleo program takes one (e.g. USDCX_ALEO, USAD_ALEO).
 *   Pre-formatted as a single Aleo input string matching the program's
 *   `[MerkleProof; 2u32].private` shape.
 * @property aleoAssetMap Override the default asset → Aleo program map, e.g.
 *   for assets the API added after this SDK release.
 * @property selectQuote Quote-picking strategy. `'best'` (default) maximizes
 *   `amountOut` with exact decimal comparison; `'fastest'` minimizes
 *   `estimatedTimeSeconds`; a callback receives all quotes and returns one.
 * @property poll `false` (default) returns right after the deposit is
 *   submitted; `true` waits for `COMPLETED`; a specific stage string waits
 *   for that stage.
 * @property timezone Optional IANA timezone, hoisted to the `x-timezone`
 *   header on order creation.
 * @property onStage Called with each order status observed while polling.
 */
export type SwapParameters = {
  wallet?: WalletClient | undefined
  from: { chain?: string | undefined; asset: string; amount: string }
  to: { chain: string; asset: string; address: string }
  provider?: string | undefined
  refundAddress?: string | undefined
  merkleProof?: string | undefined
  aleoAssetMap?: Readonly<Record<string, AleoAssetConfig>> | undefined
  selectQuote?:
    | 'best'
    | 'fastest'
    | ((quotes: BridgeQuote[]) => BridgeQuote | Promise<BridgeQuote>)
    | undefined
  poll?: boolean | BridgeOrderStage | undefined
  timezone?: string | undefined
  onStage?: ((status: BridgeOrderStatusDto) => void) | undefined
}

/**
 * What `swap` resolves with once the deposit is on its way.
 *
 * @property quoteRequestId Support handle identifying the quote request.
 * @property orderId Bridge order id, usable with `getOrder`/`waitForOrder`.
 * @property depositTxId Aleo transaction id (`at1...`) of the unshield deposit.
 * @property finalStatus Present iff `poll` was truthy — the order status that
 *   ended the wait.
 */
export type SwapReturnType = {
  quoteRequestId: string
  orderId: string
  depositTxId: string
  finalStatus?: BridgeOrderStatusDto
}

// The API's chain identifiers are case-sensitive ('ALEO', 'SOLANA', 'EVM:1').
const SRC_CHAIN = 'ALEO' as const

/** Picks one quote per the strategy; exact decimal compare for 'best'. */
async function pickQuote(
  strategy: SwapParameters['selectQuote'],
  quotes: BridgeQuote[],
): Promise<BridgeQuote> {
  if (typeof strategy === 'function') return strategy(quotes)
  if (strategy === 'fastest') {
    return quotes.reduce((fastest, q) =>
      (q.estimatedTimeSeconds ?? Number.POSITIVE_INFINITY) <
      (fastest.estimatedTimeSeconds ?? Number.POSITIVE_INFINITY)
        ? q
        : fastest,
    )
  }
  // 'best' (default): maximize amountOut
  return quotes.reduce((best, q) => (compareDecimal(q.amountOut, best.amountOut) > 0 ? q : best))
}

/**
 * Runs a whole Aleo-source bridge swap: quote, pick one, create the order,
 * sign and broadcast the Aleo unshield deposit through the source asset's
 * program, and optionally poll the order to completion.
 *
 * Hits the bridge API (quote + order), then signs, proves, and broadcasts an
 * Aleo transaction with the wallet — this moves real funds. The deposit
 * amount comes from the order's instructions, scaled to atomic units by the
 * asset's decimals (taken from the instructions when present, else the asset
 * map).
 *
 * A caveat for `token_registry.aleo` assets: the deposit transfer identifies
 * the token by the private record the signer spends, and record selection
 * cannot currently be pinned to a token id. A wallet holding records of
 * several registry tokens (USDC, USDT, WBTC, WSOL) may spend the wrong
 * token's record. Until a record-selection channel exists, only run registry
 * swaps from wallets holding records of a single registry token.
 *
 * @param client A bridge client (transport reaching the bridge API).
 * @param params Route, wallet, and strategy — see {@link SwapParameters}.
 * @returns Ids for the deposit and order — see {@link SwapReturnType}.
 * @throws BridgeError When no wallet is available, the source asset is
 *   unknown to the asset map, a required merkle proof is missing, no provider
 *   quotes the route, or the order's deposit instructions are unusable (no
 *   address/amount, or a deposit memo, which Aleo transfers cannot carry).
 * @throws BridgeOrderFailedError When polling and the order fails terminally.
 * @throws BridgeTimeoutError When polling exceeds its deadline.
 *
 * @example
 * const result = await bridge.swap({
 *   from: { asset: 'ALEO_MAINNET', amount: '100' },
 *   to: { chain: 'SOLANA', asset: 'SOL_SOLANA', address: solAddress },
 *   poll: true,
 * })
 */
export async function swap(
  client: Client,
  params: SwapParameters,
): Promise<SwapReturnType> {
  const wallet = params.wallet
  if (!wallet?.account) {
    throw new BridgeError(
      'swap requires a wallet with an account — set it at createBridgeClient({ wallet }) or pass SwapParameters.wallet',
    )
  }
  const walletAddress = wallet.account.address
  // Accept chains by identifier or display name; the API matches identifiers
  // strictly. The source must be Aleo — this action signs the deposit with an
  // Aleo wallet — but the slot exists so the constraint is a validated value,
  // not a hole in the parameter shape.
  const srcChain = resolveChainId(params.from.chain ?? SRC_CHAIN)
  if (srcChain !== SRC_CHAIN) {
    throw new BridgeError(
      `swap can only source from Aleo (got from.chain "${params.from.chain}"): the deposit is signed by the Aleo wallet. For an inbound swap, use getQuotes + createOrder and pay the deposit instructions from the source chain's wallet.`,
    )
  }
  const destChain = resolveChainId(params.to.chain)
  const refundAddress = params.refundAddress ?? walletAddress

  // Assets accept symbols; resolving costs one catalog fetch, and only when
  // a symbol is actually passed — exact codes skip it.
  let srcAsset = params.from.asset
  let destAsset = params.to.asset
  if (!isAssetCode(srcAsset) || !isAssetCode(destAsset)) {
    const assets = await getAssets(client)
    srcAsset = resolveAssetCode(assets, srcAsset, SRC_CHAIN)
    destAsset = resolveAssetCode(assets, destAsset, destChain)
  }

  // Fail on local knowledge before any further round-trip: an unknown asset
  // or missing proof discovered after createOrder leaves an abandoned order.
  const assetConfig = aleoAssetProgram(srcAsset, params.aleoAssetMap)
  if (assetConfig.requiresMerkleProof && !params.merkleProof) {
    throw new BridgeError(
      `swap source asset ${srcAsset} requires merkleProof; pass via SwapParameters.merkleProof`,
    )
  }

  // A refund address is required in practice — some providers (NEAR
  // Intents) skip quoting entirely when it is absent.
  const { quotes, meta } = await getQuotes(client, {
    srcChain,
    srcAsset,
    destChain,
    destAsset,
    amountIn: params.from.amount,
    recipientAddress: params.to.address,
    refundAddress,
  })

  if (quotes.length === 0) {
    throw new BridgeError('Bridge returned no quotes for the requested route')
  }

  // Provider pinning: restrict the pick to the requested provider's quotes,
  // failing loudly (before any funds move) when it did not quote.
  let candidates = quotes
  if (params.provider != null) {
    const wanted = params.provider.toLowerCase()
    candidates = quotes.filter((q) => q.provider.code.toLowerCase() === wanted)
    if (candidates.length === 0) {
      const quoted = [...new Set(quotes.map((q) => q.provider.code))].join(', ')
      throw new BridgeError(
        `Provider ${params.provider} returned no quote for this route (quoted: ${quoted})`,
      )
    }
  }

  const chosen = await pickQuote(params.selectQuote ?? 'best', candidates)

  if (!chosen.quoteId) {
    throw new BridgeError('Selected bridge quote is missing quoteId')
  }

  // walletAddress is the provider's payout recipient — the destination-chain
  // address, NOT the Aleo signer (the server does not fall back to the
  // quote's recipient for it).
  const instructions = await createOrder(client, {
    providerId: chosen.provider.id,
    srcChain,
    destChain,
    srcAsset,
    destAsset,
    amountIn: params.from.amount,
    walletAddress: params.to.address,
    quoteId: chosen.quoteId,
    refundAddress,
    timezone: params.timezone,
  })

  if (!instructions.depositAddress || !instructions.depositAmount) {
    throw new BridgeError('Bridge order is missing depositAddress or depositAmount')
  }
  // Aleo transfers cannot carry a memo; a memo-tagged deposit would be
  // unattributable and the funds stranded. No provider tags Aleo deposits
  // today — refuse loudly if one starts to.
  if (instructions.depositMemo) {
    throw new BridgeError(
      `Bridge order ${instructions.orderId} requires deposit memo "${instructions.depositMemo}", which Aleo transfers cannot carry — do not deposit; let the order expire`,
    )
  }

  // depositAmount comes back in display decimals ("0.5"); the program
  // transfer takes atomic units. Prefer the decimals the order itself
  // declares over the local map (the API is the source of truth).
  const decimals = instructions.instructions?.assetDecimals ?? assetConfig.decimals
  const depositTxId = await transfer(wallet, {
    asset: assetConfig.program,
    to: instructions.depositAddress,
    amount: parseDecimalAmount(instructions.depositAmount, decimals),
    visibility: 'unshield',
    amountWidth: assetConfig.amountWidth,
    ...(params.merkleProof ? { merkleProof: params.merkleProof } : {}),
  })

  if (!params.poll) {
    return {
      quoteRequestId: meta.quoteRequestId,
      orderId: instructions.orderId,
      depositTxId,
    }
  }

  const finalStatus = await waitForOrder(client, {
    id: instructions.orderId,
    until: typeof params.poll === 'string' ? params.poll : 'COMPLETED',
    onStage: params.onStage,
  })

  return {
    quoteRequestId: meta.quoteRequestId,
    orderId: instructions.orderId,
    depositTxId,
    finalStatus,
  }
}
