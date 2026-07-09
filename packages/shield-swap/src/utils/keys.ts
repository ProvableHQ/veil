import { loadSdk } from './sdk.js'

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
  const pool = stripSuffix(params.pool, 'field')
  return hashStruct(`{ pool: ${pool}field, tick: ${params.tick}i32 }`)
}
