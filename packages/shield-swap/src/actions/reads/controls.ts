import type { Client } from '@provablehq/veil-core'
import { readBoolMapping, readUintMapping } from './internal.js'
import { requirePool } from '../../utils/guards.js'
import { sortTokenPair } from '../../utils/keys.js'
import { DEFAULT_PROGRAM } from '../../constants.js'

/**
 * Formats the `pair_paused` mapping key, sorting the token pair ascending
 * exactly as `set_pair_paused` does before casting its `PairKey`.
 */
function pairKeyLiteral(token0: string, token1: string): string {
  const [t0, t1] = sortTokenPair(token0, token1)
  return `{ token0: ${t0}field, token1: ${t1}field }`
}

/**
 * Checks whether the whole program is paused.
 *
 * When `true`, every trading and liquidity transition reverts at finalize —
 * a pre-flight guard that turns a guaranteed revert into a cheap read. An
 * absent entry means not paused (the contract's `get_or_use` default).
 *
 * Hits the network: one node request via the client's transport. Caveat:
 * control state can change before finalization — a green read is advisory.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params Optionally the program to read from (defaults to
 *   `DEFAULT_PROGRAM`).
 * @returns `true` when globally paused, otherwise `false`.
 *
 * @example
 * if (await isGlobalPaused(client)) throw new Error('trading is paused')
 */
export async function isGlobalPaused(client: Client, params?: { program?: string }): Promise<boolean> {
  return readBoolMapping(client, params?.program, 'global_paused', 'true')
}

/**
 * Checks whether permissionless pool creation is open.
 *
 * When `false`, only the admin can `create_pool`. An absent entry means
 * closed (the contract's `get_or_use` default, also set by the constructor).
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params Optionally the program to read from (defaults to
 *   `DEFAULT_PROGRAM`).
 * @returns `true` when anyone may create pools, otherwise `false`.
 *
 * @example
 * const open = await isPoolCreationOpen(client)
 */
export async function isPoolCreationOpen(client: Client, params?: { program?: string }): Promise<boolean> {
  return readBoolMapping(client, params?.program, 'pool_creation_is_open', 'true')
}

/**
 * Checks whether a token is on the program's allowlist.
 *
 * `create_pool` requires both tokens allowed. An absent entry means NOT
 * allowed — allowance is opt-in, the opposite polarity of the pause flags.
 *
 * Hits the network: one node request via the client's transport. Caveat:
 * control state can change before finalization — a green read is advisory.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The token id (field literal), and optionally the program to
 *   read from (defaults to `DEFAULT_PROGRAM`).
 * @returns `true` when the token is allowed, otherwise `false`.
 *
 * @example
 * if (!(await isTokenAllowed(client, { tokenId }))) throw new Error('token not allowed')
 */
export async function isTokenAllowed(
  client: Client,
  params: { tokenId: string; program?: string },
): Promise<boolean> {
  return readBoolMapping(client, params.program, 'token_allowed', params.tokenId)
}

/**
 * Checks whether a token is individually paused.
 *
 * A paused token blocks every swap and liquidity transition that touches it.
 * An absent entry means not paused (the contract's `get_or_use` default).
 *
 * Hits the network: one node request via the client's transport. Caveat:
 * control state can change before finalization — a green read is advisory.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The token id (field literal), and optionally the program to
 *   read from (defaults to `DEFAULT_PROGRAM`).
 * @returns `true` when the token is paused, otherwise `false`.
 *
 * @example
 * const paused = await isTokenPaused(client, { tokenId })
 */
export async function isTokenPaused(
  client: Client,
  params: { tokenId: string; program?: string },
): Promise<boolean> {
  return readBoolMapping(client, params.program, 'token_paused', params.tokenId)
}

/**
 * Checks whether a token pair is paused.
 *
 * Pauses every pool over the pair regardless of fee tier. The pair is
 * order-independent — the key sorts the tokens ascending exactly as the
 * contract does. An absent entry means not paused.
 *
 * Hits the network: one node request via the client's transport. Caveat:
 * control state can change before finalization — a green read is advisory.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The two token ids (field literals, either order), and
 *   optionally the program to read from (defaults to `DEFAULT_PROGRAM`).
 * @returns `true` when the pair is paused, otherwise `false`.
 *
 * @example
 * const paused = await isPairPaused(client, { token0, token1 })
 */
export async function isPairPaused(
  client: Client,
  params: { token0: string; token1: string; program?: string },
): Promise<boolean> {
  return readBoolMapping(client, params.program, 'pair_paused', pairKeyLiteral(params.token0, params.token1))
}

/**
 * Reads the block height at which a position was frozen.
 *
 * A frozen position blocks `increase_liquidity`, `decrease_liquidity`,
 * `collect`, and `burn` until the admin unfreezes it. Absence means not
 * frozen.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The position `token_id` (field literal), and optionally the
 *   program to read from (defaults to `DEFAULT_PROGRAM`).
 * @returns The freeze block height (u32), or `null` when not frozen.
 *
 * @example
 * const frozenAt = await getFrozenPosition(client, { positionTokenId })
 */
export async function getFrozenPosition(
  client: Client,
  params: { positionTokenId: string; program?: string },
): Promise<number | null> {
  return readUintMapping(client, params.program, 'frozen_position', params.positionTokenId)
}

/**
 * Reads a token's registered decimal count.
 *
 * The registration feeds each pool's normalization scale; `create_pool`
 * hard-fails on an unregistered token. The value pairs with `dustScale` to
 * compute the no-dust rule for raw amounts.
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The token id (field literal), and optionally the program to
 *   read from (defaults to `DEFAULT_PROGRAM`).
 * @returns The decimal count (u8), or `null` when the token is unregistered.
 *
 * @example
 * const decimals = await getTokenDecimals(client, { tokenId })
 * const scale = decimals === null ? undefined : dustScale(decimals)
 */
export async function getTokenDecimals(
  client: Client,
  params: { tokenId: string; program?: string },
): Promise<number | null> {
  return readUintMapping(client, params.program, 'token_decimals', params.tokenId)
}

/**
 * A pool's complete control-gate state, batched into one call.
 *
 * @property globalPaused Whether the whole program is paused.
 * @property poolEnabled The pool's own `enabled` flag.
 * @property token0 The pool's token0 gates: its id, allowlist state, and
 *   pause state. The allowlist gates `create_pool` only — it is reported
 *   for completeness but does not affect `tradeable`.
 * @property token1 The pool's token1 gates, same shape.
 * @property pairPaused Whether the token pair is paused.
 * @property tradeable The conjunction of the gates the swap finalize
 *   actually asserts — global pause, pool `enabled`, per-token pauses, and
 *   the pair pause. `true` when nothing blocks trading this pool right now.
 */
export type GetTradeControlsReturnType = {
  globalPaused: boolean
  poolEnabled: boolean
  token0: { tokenId: string; allowed: boolean; paused: boolean }
  token1: { tokenId: string; allowed: boolean; paused: boolean }
  pairPaused: boolean
  tradeable: boolean
}

/**
 * Reads every control gate that can block trading a pool, in one call.
 *
 * Reads the pool, then fans out the global pause, both tokens' allowlist and
 * pause flags, and the pair pause concurrently. The `tradeable` conjunction
 * answers "can this pool trade right now" — the pre-flight the contract's
 * finalize otherwise answers with a revert.
 *
 * Hits the network: the pool read plus six concurrent mapping reads. Caveat:
 * control state can change before finalization — a green read is advisory,
 * not a guarantee.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The pool key, and optionally the program to read from
 *   (defaults to `DEFAULT_PROGRAM`).
 * @returns The per-gate states and the combined `tradeable` verdict.
 * @throws When the pool does not exist under the key.
 *
 * @example
 * const controls = await getTradeControls(client, { poolKey })
 * if (!controls.tradeable) console.log('blocked:', controls)
 */
export async function getTradeControls(
  client: Client,
  params: { poolKey: string; program?: string },
): Promise<GetTradeControlsReturnType> {
  const pool = await requirePool(client, params.poolKey, params.program ?? DEFAULT_PROGRAM)
  const p = { program: params.program }
  const [globalPaused, t0Allowed, t0Paused, t1Allowed, t1Paused, pairPaused] = await Promise.all([
    isGlobalPaused(client, p),
    isTokenAllowed(client, { tokenId: pool.token0, ...p }),
    isTokenPaused(client, { tokenId: pool.token0, ...p }),
    isTokenAllowed(client, { tokenId: pool.token1, ...p }),
    isTokenPaused(client, { tokenId: pool.token1, ...p }),
    isPairPaused(client, { token0: pool.token0, token1: pool.token1, ...p }),
  ])
  // The swap finalize asserts exactly these gates; token_allowed gates
  // create_pool only, so it stays out of the verdict.
  const tradeable = !globalPaused && pool.enabled && !t0Paused && !t1Paused && !pairPaused
  return {
    globalPaused,
    poolEnabled: pool.enabled,
    token0: { tokenId: pool.token0, allowed: t0Allowed, paused: t0Paused },
    token1: { tokenId: pool.token1, allowed: t1Allowed, paused: t1Paused },
    pairPaused,
    tradeable,
  }
}
