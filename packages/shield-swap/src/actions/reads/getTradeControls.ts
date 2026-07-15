import type { Client } from '@provablehq/veil-core'
import { requirePool } from '../../utils/guards.js'
import { DEFAULT_PROGRAM } from '../../constants.js'
import { isGlobalPaused } from './isGlobalPaused.js'
import { isTokenAllowed } from './isTokenAllowed.js'
import { isTokenPaused } from './isTokenPaused.js'
import { isPairPaused } from './isPairPaused.js'

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
