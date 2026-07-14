import { loadSdk } from './sdk.js'
import {
  formatMintPositionRequest,
  formatSwapHop,
  EMPTY_SWAP_HOP_LITERAL,
  type MintPositionRequestInput,
  type SwapHopInput,
} from './params.js'

/**
 * Removes a trailing Aleo type suffix from a literal, if present.
 *
 * Accepts both `123…field` and the bare `123…` form so callers can pass
 * whichever they hold. Leaves an already-bare literal untouched.
 */
function stripSuffix(literal: string, suffix: string): string {
  const trimmed = literal.trim()
  return trimmed.endsWith(suffix) ? trimmed.slice(0, -suffix.length) : trimmed
}

/**
 * Normalizes a field literal to its suffixed form, accepting bare input —
 * the tolerance every derivation in this file grants uniformly.
 */
function fieldLiteral(literal: string): string {
  return `${stripSuffix(literal, 'field')}field`
}

/**
 * Hashes an Aleo struct literal to a field with BHP256, matching the contract's
 * `hash.bhp256 <struct> into field`. Loads the optional `@provablehq/sdk` peer
 * on first call; single-sources the correctness-critical hash step both key
 * derivations share.
 */
async function hashStruct(struct: string): Promise<string> {
  const { BHP256, Plaintext } = await loadSdk()
  return new BHP256().hash(Plaintext.fromString(struct).toBitsLe()).toString()
}

/**
 * Parameters for {@link derivePoolKey}.
 *
 * @property token0 One token's ARC-20 program id as a `field` literal (the
 *   `field` suffix is optional). Order does not matter — the pair is sorted
 *   ascending to match the program.
 * @property token1 The other token's id as a `field` literal.
 * @property fee Fee tier in pips (u16), e.g. `3000` for 0.30%.
 */
export interface DerivePoolKeyParameters {
  token0: string
  token1: string
  fee: number
}

/**
 * Derives a pool key from its token pair and fee tier, without the network.
 *
 * Computes `BHP256::hash_to_field(PoolKey { token0, token1, fee })` locally,
 * matching the program byte-for-byte: the pair is sorted ascending (as the
 * contract does before hashing) and hashed as a struct plaintext. Use it to
 * address a pool from `(token0, token1, fee)` — reading `pools`/`slots`
 * directly, or checking a pool exists — without a `getPools` round trip.
 *
 * Loads the optional `@provablehq/sdk` peer on first call (see {@link loadSdk});
 * pure and local otherwise — no network, no signing.
 *
 * @param params The token pair and fee tier.
 * @returns The pool key as a `field` literal (e.g. `"4719…field"`), the form
 *   `getPool`/`getSlot`/`swap` expect.
 * @throws When `@provablehq/sdk` is not installed, when a token literal does
 *   not parse as a field, or when `fee` is not a u16 (0–65535).
 *
 * @example
 * const poolKey = await derivePoolKey({ token0, token1, fee: 3000 })
 * const slot = await client.getSlot({ poolKey })
 */
export async function derivePoolKey(params: DerivePoolKeyParameters): Promise<string> {
  // Sort the pair ascending, matching the program's sorted_token0/1 before it
  // hashes — the key is order-independent in the token arguments.
  const a = BigInt(stripSuffix(params.token0, 'field'))
  const b = BigInt(stripSuffix(params.token1, 'field'))
  const [token0, token1] = a <= b ? [a, b] : [b, a]

  return hashStruct(`{ token0: ${token0}field, token1: ${token1}field, fee: ${params.fee}u16 }`)
}

/**
 * Parameters for {@link deriveTickKey}.
 *
 * @property pool The pool key as a `field` literal (the `field` suffix is
 *   optional), e.g. from {@link derivePoolKey} or `pool.key`.
 * @property tick The tick index (i32).
 */
export interface DeriveTickKeyParameters {
  pool: string
  tick: number
}

/**
 * Derives the key for an individual tick, without the network.
 *
 * Computes `BHP256::hash_to_field(TickKey { pool, tick })` locally, matching
 * the program's `get_tick_key`. Applies when reading a specific tick from the
 * `ticks` mapping — e.g. walking `prev`/`next` to find an authoritative
 * insertion predecessor, which needs tick keys the API does not expose.
 *
 * Loads the optional `@provablehq/sdk` peer on first call; pure and local
 * otherwise.
 *
 * @param params The pool key and tick index.
 * @returns The tick key as a `field` literal, the form the `ticks` mapping
 *   read expects.
 * @throws When `@provablehq/sdk` is not installed, when the pool literal does
 *   not parse as a field, or when `tick` is not an i32.
 *
 * @example
 * const tickKey = await deriveTickKey({ pool: poolKey, tick: -600 })
 * const tick = await publicClient.readContract({ programId, mapping: 'ticks', key: tickKey })
 */
export async function deriveTickKey(params: DeriveTickKeyParameters): Promise<string> {
  return hashStruct(`{ pool: ${fieldLiteral(params.pool)}, tick: ${params.tick}i32 }`)
}

/**
 * Parameters for {@link deriveSwapId}.
 *
 * @property poolKey Pool key field literal the swap trades against (the
 *   `field` suffix is optional).
 * @property zeroForOne True when selling the pool's token0 for token1.
 * @property amountIn Raw atomic amount sold (u128), as passed to `swap`.
 * @property sqrtPriceLimit Q64 price bound (u128), as passed to `swap`.
 * @property blindedAddress The swap's single-use blinded address — the
 *   contract records it as both `recipient` and `caller` in the preimage.
 * @property nonce The swap's u64 nonce.
 */
export interface DeriveSwapIdParameters {
  poolKey: string
  zeroForOne: boolean
  amountIn: bigint
  sqrtPriceLimit: bigint
  blindedAddress: string
  nonce: bigint
}

/**
 * Derives a single-hop swap id without the network.
 *
 * Computes `BHP256::hash_to_field(SwapKey)` exactly as the `swap` transition
 * does, with the blinded address occupying both the `recipient` and `caller`
 * slots. Applies when the id is needed before the transaction confirms —
 * e.g. a wallet-path swap whose `blindedIdentity` the dapp supplied, or
 * re-deriving an id from persisted swap parameters.
 *
 * Loads the optional `@provablehq/sdk` peer on first call (see
 * {@link loadSdk}); pure and local otherwise — no network, no signing.
 *
 * @param params The swap's preimage fields, exactly as submitted.
 * @returns The swap id as a `field` literal — the `swap_outputs` mapping key.
 * @throws When `@provablehq/sdk` is not installed, or when a literal does
 *   not parse as its Aleo type.
 *
 * @example
 * const swapId = await deriveSwapId({
 *   poolKey, zeroForOne: true, amountIn, sqrtPriceLimit, blindedAddress, nonce,
 * })
 * const out = await getSwapOutput(client, { swapId })
 */
export async function deriveSwapId(params: DeriveSwapIdParameters): Promise<string> {
  const pool = fieldLiteral(params.poolKey)
  return hashStruct(
    `{ pool: ${pool}, zero_for_one: ${params.zeroForOne}, amount_in: ${params.amountIn}u128, ` +
      `sqrt_price_limit: ${params.sqrtPriceLimit}u128, recipient: ${params.blindedAddress}, ` +
      `nonce: ${params.nonce}u64, caller: ${params.blindedAddress} }`,
  )
}

/**
 * Parameters for {@link derivePositionTokenId}.
 *
 * @property request The mint request exactly as submitted (spacing-aligned
 *   ticks, resolved hints) — the same fields `mint` formats into its
 *   `MintPositionRequest` input.
 * @property recipient The position owner address, as passed to `mint`.
 * @property nonce The mint's field-literal nonce (the `field` suffix is
 *   optional).
 */
export interface DerivePositionTokenIdParameters {
  request: MintPositionRequestInput
  recipient: string
  nonce: string
}

/**
 * Derives a position's `token_id` without the network.
 *
 * Computes `BHP256::hash_to_field(TokenIDPreimage { request, recipient,
 * nonce })` exactly as the `mint` transition does. Every preimage field is
 * client-known before submission — including on the wallet path — so the id
 * a mint will produce is computable ahead of confirmation. The id is the
 * `positions` mapping key and the handle for later liquidity operations.
 *
 * Loads the optional `@provablehq/sdk` peer on first call; pure and local
 * otherwise.
 *
 * @param params The mint's preimage fields, exactly as submitted.
 * @returns The position token id as a `field` literal.
 * @throws When `@provablehq/sdk` is not installed, or when a literal does
 *   not parse as its Aleo type.
 *
 * @example
 * const tokenId = await derivePositionTokenId({ request, recipient, nonce })
 * const position = await getPosition(client, { positionTokenId: tokenId })
 */
export async function derivePositionTokenId(params: DerivePositionTokenIdParameters): Promise<string> {
  // Grant the request's pool key the same bare-or-suffixed tolerance as the
  // sibling derivations.
  const request = { ...params.request, pool: fieldLiteral(params.request.pool) }
  return hashStruct(
    `{ request: ${formatMintPositionRequest(request)}, recipient: ${params.recipient}, ` +
      `nonce: ${fieldLiteral(params.nonce)} }`,
  )
}

/**
 * Parameters for {@link deriveMultiHopSwapId}.
 *
 * @property tokenInId Token id (field literal) sold into the route.
 * @property tokenOutId Token id (field literal) the route pays out.
 * @property amountIn Raw atomic input amount (u128).
 * @property amountOutMin Minimum acceptable final output (u128).
 * @property blindedAddress The swap's single-use blinded address (occupies
 *   both `recipient` and `caller` in the preimage).
 * @property hops The 2–3 resolved hops, in route order.
 * @property nonce The swap's u64 nonce.
 * @property deadline Absolute block height (u32) — part of the multi-hop
 *   preimage, unlike the single-hop `SwapKey`.
 */
export interface DeriveMultiHopSwapIdParameters {
  tokenInId: string
  tokenOutId: string
  amountIn: bigint
  amountOutMin: bigint
  blindedAddress: string
  hops: SwapHopInput[]
  nonce: bigint
  deadline: number
}

/**
 * Derives a multi-hop swap id without the network.
 *
 * Computes `BHP256::hash_to_field(SwapMultiHopRequest)` exactly as the
 * `swap_multi_hop` transition does: the blinded address as `recipient` and
 * `caller`, unused hop slots zero-padded, and — unlike the single-hop id —
 * the deadline included in the preimage.
 *
 * Loads the optional `@provablehq/sdk` peer on first call; pure and local
 * otherwise.
 *
 * @param params The multi-hop request fields, exactly as submitted.
 * @returns The swap id as a `field` literal — the `swap_outputs` mapping key.
 * @throws When `hops` is not 2 or 3 entries; when `@provablehq/sdk` is not
 *   installed; or when a literal does not parse as its Aleo type.
 *
 * @example
 * const swapId = await deriveMultiHopSwapId({
 *   tokenInId, tokenOutId, amountIn, amountOutMin: 0n,
 *   blindedAddress, hops, nonce, deadline,
 * })
 */
export async function deriveMultiHopSwapId(params: DeriveMultiHopSwapIdParameters): Promise<string> {
  if (params.hops.length < 2 || params.hops.length > 3) {
    throw new Error(`swap_multi_hop takes 2 or 3 hops, got ${params.hops.length} — use swap for a single hop`)
  }
  // A hole would silently hash the zero padding under hop_count 3 — an id
  // that can never match any on-chain submission. Fail loudly instead.
  if (params.hops.some((h) => !h)) {
    throw new Error('hops must not contain empty slots')
  }
  // Normalize pool literals so bare and suffixed keys hash identically.
  const hop = (h: SwapHopInput) => formatSwapHop({ ...h, poolKey: fieldLiteral(h.poolKey) })
  const [hop0, hop1, hop2 = EMPTY_SWAP_HOP_LITERAL] = params.hops.map(hop)
  const tokenIn = fieldLiteral(params.tokenInId)
  const tokenOut = fieldLiteral(params.tokenOutId)
  return hashStruct(
    `{ token_in: ${tokenIn}, token_out: ${tokenOut}, amount_in: ${params.amountIn}u128, ` +
      `amount_out_min: ${params.amountOutMin}u128, recipient: ${params.blindedAddress}, ` +
      `hop0: ${hop0}, hop1: ${hop1}, hop2: ${hop2}, hop_count: ${params.hops.length}u8, ` +
      `nonce: ${params.nonce}u64, deadline: ${params.deadline}u32, caller: ${params.blindedAddress} }`,
  )
}
