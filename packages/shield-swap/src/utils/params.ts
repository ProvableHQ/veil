import { getBlockNumber, type Client } from '@provablehq/veil-core'
import type { PoolState, Slot } from '../generated/shield_swap.js'
import { MIN_SQRT_PRICE, MAX_SQRT_PRICE, Q64 } from './tick-math.js'

/**
 * Parameters for {@link resolveSwapParams}.
 *
 * @property pool Static pool config from `getPool` (token ordering + scales).
 * @property slot Live pool state from `getSlot` (current sqrt price) — used
 *   for the spot-estimate fallback when `expectedOut` is not given.
 * @property tokenInId Token id (field literal) of the token being sold. Must
 *   be one of the pool's two tokens.
 * @property amountIn Raw atomic amount to sell (u128). Must be a multiple of
 *   the token's normalization scale (see `dustScale`) — checked here so a
 *   doomed transaction is never submitted.
 * @property slippageBps Slippage tolerance in basis points (e.g. 50 = 0.5%)
 *   applied to `expectedOut` (or the spot estimate) to produce
 *   `amount_out_min`.
 * @property expectedOut Expected output amount from a quote (e.g. the
 *   the API's `/route`). Optional; without it a spot-price estimate from
 *   `slot.sqrt_price` is used, which ignores price impact and fees — fine
 *   for small trades, too loose for large ones.
 * @property sqrtPriceLimit Explicit Q64 price bound. Defaults to the
 *   directional extreme (MIN/MAX_SQRT_PRICE), i.e. "no price limit — rely on
 *   amount_out_min", the common Uniswap-style configuration.
 */
export type ResolveSwapParamsInput = {
  pool: PoolState
  slot: Slot
  tokenInId: string
  amountIn: bigint
  slippageBps: number
  expectedOut?: bigint
  sqrtPriceLimit?: bigint
}

/**
 * Swap arguments resolved from a friendly intent.
 *
 * @property zeroForOne True when selling the pool's token0 for token1.
 * @property tokenOutId Token id (field literal) of the token being bought.
 * @property amountOutMin Minimum acceptable output (u128) after slippage.
 * @property sqrtPriceLimit Q64 price bound for the swap.
 */
export type ResolvedSwapParams = {
  zeroForOne: boolean
  tokenOutId: string
  amountOutMin: bigint
  sqrtPriceLimit: bigint
}

/**
 * Resolves a friendly swap intent into the contract's raw arguments.
 *
 * Determines trade direction from the pool's token ordering, validates the
 * amount against the contract's no-dust rule, and computes `amount_out_min`
 * from the slippage tolerance. Pure and local — read `pool`/`slot` first.
 *
 * @param params The intent plus the pool state it executes against.
 * @returns Direction, output token, minimum output, and price bound.
 * @throws When `tokenInId` is not in the pool; when `amountIn` violates the
 *   no-dust rule (would revert on-chain); when `slippageBps` is outside
 *   [0, 10000]; or when an explicit `sqrtPriceLimit` lies outside the
 *   contract's accepted range or not strictly beyond the current price in
 *   the trade direction (the finalize rejects both).
 *
 * @example
 * const p = resolveSwapParams({ pool, slot, tokenInId, amountIn: 1_000_000_000n, slippageBps: 50 })
 * // p.zeroForOne, p.amountOutMin, p.sqrtPriceLimit → swap args
 */
export function resolveSwapParams(params: ResolveSwapParamsInput): ResolvedSwapParams {
  const { pool, slot, tokenInId, amountIn, slippageBps } = params

  if (slippageBps < 0 || slippageBps > 10000) {
    throw new Error(`slippageBps must be within [0, 10000], got ${slippageBps}`)
  }

  const zeroForOne = tokenInId === pool.token0
  if (!zeroForOne && tokenInId !== pool.token1) {
    throw new Error(`Token ${tokenInId} is not in this pool (${pool.token0} / ${pool.token1})`)
  }
  const tokenOutId = zeroForOne ? pool.token1 : pool.token0

  // The contract normalizes amounts by the token's scale and asserts
  // raw % scale == 0 — reject dust here instead of paying for a revert.
  const scaleIn = zeroForOne ? pool.scale0 : pool.scale1
  if (amountIn % scaleIn !== 0n) {
    throw new Error(
      `amountIn ${amountIn} is not a multiple of the token's scale ${scaleIn} — ` +
        'the contract rejects amounts with non-zero dust digits',
    )
  }

  // Expected output: caller-provided quote, or a spot estimate from the
  // current sqrt price (normalized units: price = (sqrtP/Q64)^2 token1/token0).
  const expected = params.expectedOut ?? spotOutEstimate(pool, slot.sqrt_price, amountIn, zeroForOne)

  const amountOutMin = (expected * BigInt(10000 - slippageBps)) / 10000n

  // Default price bound: the directional extreme — amount_out_min is the
  // real protection; a tight sqrt limit turns into partial fills instead.
  const defaultLimit = zeroForOne ? MIN_SQRT_PRICE : MAX_SQRT_PRICE
  const sqrtPriceLimit = params.sqrtPriceLimit ?? defaultLimit
  assertSqrtPriceLimit(sqrtPriceLimit, slot.sqrt_price, zeroForOne, 'swap')

  return { zeroForOne, tokenOutId, amountOutMin, sqrtPriceLimit }
}

/**
 * Parameters for {@link resolveMultiHopParams}.
 *
 * @property pools Static pool config per hop, in route order (from `getPool`).
 * @property slots Live pool state per hop, in route order (from `getSlot`) —
 *   used for the chained spot-estimate fallback when `expectedOut` is absent.
 * @property poolKeys The 2–3 pool keys, in route order.
 * @property tokenInId Token id (field literal) sold into the route. Must be
 *   in the first pool.
 * @property amountIn Raw atomic input amount (u128). Must be a multiple of
 *   the input token's scale (the contract's no-dust rule).
 * @property slippageBps Slippage tolerance in basis points, applied once to
 *   the route's expected final output.
 * @property expectedOut Quoted final output (e.g. the API's `/route`).
 *   Optional; without it a chained spot estimate is used, which ignores
 *   price impact and fees on every hop — too loose for large trades.
 * @property sqrtPriceLimits Per-hop Q64 price bounds. Defaults each hop to
 *   its directional extreme (rely on `amount_out_min`).
 */
export type ResolveMultiHopParamsInput = {
  pools: PoolState[]
  slots: Slot[]
  poolKeys: string[]
  tokenInId: string
  amountIn: bigint
  slippageBps: number
  expectedOut?: bigint
  sqrtPriceLimits?: bigint[]
}

/**
 * Multi-hop swap arguments resolved from a friendly intent.
 *
 * @property hops The resolved hops in route order — direction and price
 *   bound fixed, ready for `formatSwapHop`.
 * @property tokenOutId Token id (field literal) the route pays out.
 * @property amountOutMin Minimum acceptable final output (u128) after
 *   slippage.
 */
export type ResolvedMultiHopParams = {
  hops: SwapHopInput[]
  tokenOutId: string
  amountOutMin: bigint
}

/**
 * Resolves a friendly multi-hop swap intent into the contract's raw
 * arguments.
 *
 * Walks the token path from `tokenInId` through each pool's token pair to
 * fix hop directions and the final output token, validates the input against
 * the first pool's no-dust rule, and computes `amount_out_min` by applying
 * the slippage tolerance once to the route's expected output. Pure and
 * local — read `pools`/`slots` first.
 *
 * @param input The intent plus the per-hop pool state it executes against.
 * @returns Resolved hops, output token, and minimum output.
 * @throws When the hop count is not 2 or 3; when `pools`/`slots` do not
 *   align one-to-one with `poolKeys`; when the token path does not connect
 *   through the pools; when `amountIn` violates the first pool's no-dust
 *   rule; when `slippageBps` is outside [0, 10000]; when `sqrtPriceLimits`
 *   is given with a length other than one entry per hop; or when a price
 *   limit lies outside the contract's accepted range or not strictly beyond
 *   the hop's current price in the trade direction (the finalize rejects
 *   both).
 *
 * @example
 * const r = resolveMultiHopParams({ pools, slots, poolKeys, tokenInId, amountIn, slippageBps: 50 })
 */
export function resolveMultiHopParams(input: ResolveMultiHopParamsInput): ResolvedMultiHopParams {
  const { pools, slots, poolKeys, tokenInId, amountIn, slippageBps } = input
  if (poolKeys.length < 2 || poolKeys.length > 3) {
    throw new Error(`swap_multi_hop takes 2 or 3 hops, got ${poolKeys.length} — use swap for a single hop`)
  }
  if (pools.length !== poolKeys.length || slots.length !== poolKeys.length) {
    throw new Error('pools, slots, and poolKeys must align one-to-one in hop order')
  }
  if (slippageBps < 0 || slippageBps > 10000) {
    throw new Error(`slippageBps must be within [0, 10000], got ${slippageBps}`)
  }
  if (input.sqrtPriceLimits && input.sqrtPriceLimits.length !== poolKeys.length) {
    throw new Error('sqrtPriceLimits must have one entry per hop when given')
  }

  const hops: SwapHopInput[] = []
  let currentToken = tokenInId
  // Chained spot estimate, maintained alongside the walk; used only when the
  // caller gave no quote.
  let estimate: bigint | undefined = input.expectedOut === undefined ? amountIn : undefined

  pools.forEach((pool, i) => {
    const zeroForOne = currentToken === pool.token0
    if (!zeroForOne && currentToken !== pool.token1) {
      throw new Error(
        `Hop ${i}: token ${currentToken} is not in pool ${poolKeys[i]} ` +
          `(${pool.token0} / ${pool.token1}) — the hop path does not connect`,
      )
    }
    // The contract's no-dust rule applies to the route input only; the chain
    // normalizes intermediate amounts itself.
    if (i === 0) {
      const scaleIn = zeroForOne ? pool.scale0 : pool.scale1
      if (amountIn % scaleIn !== 0n) {
        throw new Error(
          `amountIn ${amountIn} is not a multiple of the input token's scale ${scaleIn} — ` +
            'the contract rejects amounts with non-zero dust digits',
        )
      }
    }
    if (estimate !== undefined) {
      estimate = spotOutEstimate(pool, slots[i]!.sqrt_price, estimate, zeroForOne)
    }

    const defaultLimit = zeroForOne ? MIN_SQRT_PRICE : MAX_SQRT_PRICE
    const sqrtPriceLimit = input.sqrtPriceLimits?.[i] ?? defaultLimit
    assertSqrtPriceLimit(sqrtPriceLimit, slots[i]!.sqrt_price, zeroForOne, `Hop ${i}`)
    hops.push({ poolKey: poolKeys[i]!, zeroForOne, sqrtPriceLimit })
    currentToken = zeroForOne ? pool.token1 : pool.token0
  })

  const expected = input.expectedOut ?? estimate!
  const amountOutMin = (expected * BigInt(10000 - slippageBps)) / 10000n
  return { hops, tokenOutId: currentToken, amountOutMin }
}

/**
 * Computes a swap deadline as an absolute block height.
 *
 * The contract's `deadline` is a block height (u32), not a timestamp: the
 * finalize asserts the current height is below it. Reads the current height
 * from the node and adds an offset.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params Optional offset in blocks. Defaults to 100 (~several
 *   minutes) — enough for proving + broadcast + inclusion without leaving a
 *   stale swap request valid for long.
 * @returns The deadline block height as a plain number (u32).
 *
 * @example
 * const deadline = await getDeadline(client) // height + 100
 */
export async function getDeadline(client: Client, params?: { offsetBlocks?: number }): Promise<number> {
  const height = await getBlockNumber(client)
  return Number(height) + (params?.offsetBlocks ?? 100)
}

/**
 * The `MintPositionRequest` fields in TypeScript form.
 *
 * @property pool Pool key field literal.
 * @property tickLower Lower bound of the range (i32, already spacing-aligned).
 * @property tickUpper Upper bound of the range (i32).
 * @property amount0Desired Raw atomic token0 deposit (u128).
 * @property amount1Desired Raw atomic token1 deposit (u128).
 * @property amount0Min Minimum token0 actually taken (u128 slippage guard).
 * @property amount1Min Minimum token1 actually taken (u128).
 * @property tickLowerHint Insert hint for the lower tick (i32).
 * @property tickUpperHint Insert hint for the upper tick (i32).
 */
export type MintPositionRequestInput = {
  pool: string
  tickLower: number
  tickUpper: number
  amount0Desired: bigint
  amount1Desired: bigint
  amount0Min: bigint
  amount1Min: bigint
  tickLowerHint: number
  tickUpperHint: number
}

/**
 * Formats a MintPositionRequest struct literal in the contract's exact
 * field order — pool, ticks, desired/min amounts, hints. Order is
 * load-bearing: struct hashing and the transition input both depend on it.
 * Pure and local.
 *
 * @param req The request fields, already resolved (spacing-aligned ticks,
 *   computed hints).
 * @returns The struct literal the `mint` transition and the token-id hash
 *   consume.
 *
 * @example
 * const request = formatMintPositionRequest({ pool, tickLower, tickUpper,
 *   amount0Desired, amount1Desired, amount0Min: 0n, amount1Min: 0n,
 *   tickLowerHint, tickUpperHint })
 */
export function formatMintPositionRequest(req: MintPositionRequestInput): string {
  return (
    `{ pool: ${req.pool}, tick_lower: ${req.tickLower}i32, tick_upper: ${req.tickUpper}i32, ` +
    `amount0_desired: ${req.amount0Desired}u128, amount1_desired: ${req.amount1Desired}u128, ` +
    `amount0_min: ${req.amount0Min}u128, amount1_min: ${req.amount1Min}u128, ` +
    `tick_lower_hint: ${req.tickLowerHint}i32, tick_upper_hint: ${req.tickUpperHint}i32 }`
  )
}

/**
 * One hop of a multi-hop swap in TypeScript form.
 *
 * @property poolKey Pool key field literal the hop trades against.
 * @property zeroForOne True when the hop sells the pool's token0 for token1.
 * @property sqrtPriceLimit Q64 price bound for the hop (u128).
 */
export type SwapHopInput = { poolKey: string; zeroForOne: boolean; sqrtPriceLimit: bigint }

/**
 * Formats a SwapHop struct literal in the contract's exact field order.
 * Order is load-bearing: the multi-hop request hash and the transition
 * inputs both depend on it. Pure and local.
 *
 * @param hop The resolved hop; the pool key MUST carry its `field` suffix.
 * @returns The struct literal the `swap_multi_hop` transition and the
 *   multi-hop request hash consume.
 *
 * @example
 * const hop0 = formatSwapHop({ poolKey, zeroForOne: true, sqrtPriceLimit: MIN_SQRT_PRICE })
 */
export function formatSwapHop(hop: SwapHopInput): string {
  return `{ pool: ${hop.poolKey}, zero_for_one: ${hop.zeroForOne}, sqrt_price_limit: ${hop.sqrtPriceLimit}u128 }`
}

/**
 * The padding literal for an unused hop slot. The contract guards every
 * hop2 assertion behind `hop_count == 3`, so a zeroed hop is inert.
 */
export const EMPTY_SWAP_HOP_LITERAL = formatSwapHop({
  poolKey: '0field',
  zeroForOne: false,
  sqrtPriceLimit: 0n,
})

/**
 * Formats a 2–3 hop route into the contract's three fixed `SwapHop` slots,
 * zero-padding the unused third slot.
 *
 * Single-sources the padding invariant the transition inputs and the
 * multi-hop id hash both depend on — the two MUST agree byte-for-byte or a
 * derived id can never match the chain's. Pure and local.
 *
 * @param hops The resolved hops in route order; pool keys MUST carry their
 *   `field` suffix.
 * @returns Exactly three struct literals — hop0, hop1, and hop2 or the zero
 *   padding.
 * @throws When `hops` is not 2 or 3 entries, or contains an empty slot (a
 *   hole would silently hash the padding under `hop_count` 3 — an id that
 *   can never match any on-chain submission).
 *
 * @example
 * const [hop0, hop1, hop2] = formatSwapHopSlots(resolved.hops)
 */
export function formatSwapHopSlots(hops: SwapHopInput[]): [string, string, string] {
  if (hops.length < 2 || hops.length > 3) {
    throw new Error(`swap_multi_hop takes 2 or 3 hops, got ${hops.length} — use swap for a single hop`)
  }
  if (hops.some((h) => !h)) {
    throw new Error('hops must not contain empty slots')
  }
  const [hop0, hop1, hop2 = EMPTY_SWAP_HOP_LITERAL] = hops.map(formatSwapHop)
  return [hop0!, hop1!, hop2]
}

/**
 * Estimates a hop's output at the current spot price, ignoring price impact
 * and fees — the quote-free fallback both swap resolvers share.
 *
 * Normalizes by the pool scales and applies the Q64 price square in the
 * trade direction. Fine for small trades; too loose for large ones.
 */
function spotOutEstimate(pool: PoolState, sqrtPrice: bigint, amountIn: bigint, zeroForOne: boolean): bigint {
  const scaleIn = zeroForOne ? pool.scale0 : pool.scale1
  const scaleOut = zeroForOne ? pool.scale1 : pool.scale0
  const normIn = amountIn / scaleIn
  const normOut = zeroForOne ? (normIn * sqrtPrice * sqrtPrice) / (Q64 * Q64) : (normIn * Q64 * Q64) / (sqrtPrice * sqrtPrice)
  return normOut * scaleOut
}

/**
 * Validates a hop's price bound against the contract's finalize asserts:
 * within [MIN, MAX], and strictly beyond the pool's current sqrt price in
 * the trade direction. A bound that fails either check produces a
 * transaction that can only revert — reject it before proving.
 */
function assertSqrtPriceLimit(limit: bigint, currentSqrtPrice: bigint, zeroForOne: boolean, label: string): void {
  if (limit < MIN_SQRT_PRICE || limit > MAX_SQRT_PRICE) {
    throw new Error(
      `${label}: sqrtPriceLimit ${limit} outside the contract's accepted range [${MIN_SQRT_PRICE}, ${MAX_SQRT_PRICE}]`,
    )
  }
  if (zeroForOne ? limit >= currentSqrtPrice : limit <= currentSqrtPrice) {
    throw new Error(
      `${label}: sqrtPriceLimit ${limit} does not lie strictly beyond the current sqrt price ` +
        `${currentSqrtPrice} in the trade direction — the contract's finalize rejects it`,
    )
  }
}

/**
 * Generates a random u64 nonce for `swap`.
 *
 * The nonce uniquifies the swap id so identical back-to-back swaps do not
 * collide in `swap_outputs`. Pure and local (crypto-random). Requires a
 * runtime with the WebCrypto global (browsers, Node 19+).
 *
 * @returns A uniformly random u64 as `bigint`.
 *
 * @example
 * const nonce = generateSwapNonce()
 */
export function generateSwapNonce(): bigint {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)
}

/**
 * Generates a random field literal for `mint`'s nonce input.
 *
 * The mint nonce is hashed into the position's `token_id`, so a fresh value
 * per call lets one (recipient, request) pair mint multiple positions
 * without id collisions. Pure and local (crypto-random); 31 bytes keeps the
 * value below the field modulus. Requires a runtime with the WebCrypto
 * global (browsers, Node 19+).
 *
 * @returns A random field literal (e.g. `"1234…field"`).
 *
 * @example
 * const nonce = generateFieldNonce() // mint input 0
 */
export function generateFieldNonce(): string {
  const bytes = new Uint8Array(31)
  globalThis.crypto.getRandomValues(bytes)
  return `${bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)}field`
}
