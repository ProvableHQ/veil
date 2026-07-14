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
 *   contract's accepted range.
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
  let expected = params.expectedOut
  if (expected === undefined) {
    const scaleOut = zeroForOne ? pool.scale1 : pool.scale0
    const normIn = amountIn / scaleIn
    const sq = slot.sqrt_price
    const normOut = zeroForOne
      ? (normIn * sq * sq) / (Q64 * Q64)
      : (normIn * Q64 * Q64) / (sq * sq)
    expected = normOut * scaleOut
  }

  const amountOutMin = (expected * BigInt(10000 - slippageBps)) / 10000n

  // Default price bound: the directional extreme — amount_out_min is the
  // real protection; a tight sqrt limit turns into partial fills instead.
  const defaultLimit = zeroForOne ? MIN_SQRT_PRICE : MAX_SQRT_PRICE
  const sqrtPriceLimit = params.sqrtPriceLimit ?? defaultLimit
  if (sqrtPriceLimit < MIN_SQRT_PRICE || sqrtPriceLimit > MAX_SQRT_PRICE) {
    throw new Error(
      `sqrtPriceLimit ${sqrtPriceLimit} outside the contract's accepted range [${MIN_SQRT_PRICE}, ${MAX_SQRT_PRICE}]`,
    )
  }

  return { zeroForOne, tokenOutId, amountOutMin, sqrtPriceLimit }
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
