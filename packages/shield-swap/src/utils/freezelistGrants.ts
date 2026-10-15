import { freezelistProofGrant, type AlgorithmGrant } from '@provablehq/veil-core'
import { SHIELD_SWAP, SHIELD_SWAP_FREEZELIST, SHIELD_SWAP_ROUTER, SHIELD_SWAP_LP_ROUTER, SHIELD_SWAP_REBALANCE_ROUTER } from '../constants.js'
import type { WalletFreezelistProofParameters } from './proofs.js'

/**
 * Configures grants for the deployment used by wallet-derived proofs.
 *
 * @property wrapperFreezelists Maps wrappers to actual lists; `null` omits
 *   grants for no-compliance wrappers, and an empty map permits AMM proofs only.
 * @property ammFreezelistProgram AMM compliance list, defaulting to
 *   `shield_swap_freezelist.aleo`.
 * @property program Core AMM target, defaulting to `shield_swap.aleo`.
 * @property routerProgram Swap router, defaulting to `shield_swap_router.aleo`.
 * @property lpRouterProgram Liquidity router, defaulting to `shield_swap_lp_router.aleo`.
 * @property rebalanceRouterProgram Rebalance router, defaulting to `shield_swap_rebalance_router.aleo`.
 *
 * @example
 * const params: ShieldSwapFreezelistGrantsParameters = { wrapperFreezelists: {} }
 */
export interface ShieldSwapFreezelistGrantsParameters extends WalletFreezelistProofParameters {
  program?: string
  routerProgram?: string
  lpRouterProgram?: string
  rebalanceRouterProgram?: string
}

// Positions are pinned ABI facts, independently checked against all four ABIs.
// Each tuple contains [function, AMM proof positions, wrapper proof positions].
const CORE: readonly (readonly [string, readonly number[], readonly number[]])[] = [
  ['mint', [8, 9, 10], []],
  ['collect', [5, 6], []],
  ['rebalance_position', [4, 5], []],
  ['claim_swap_output', [7], []],
  ['claim_swap_output_no_refund', [6], []],
]
const SWAP: typeof CORE = [
  ['swap_from_wrapped', [], [1]],
  ['swap_mh_from_wrapped', [], [1]],
  ['claim_to_arc20_no_refund', [6], []],
  ['claim_to_wrapped_no_refund', [6], [7]],
  ['claim_to_wrapped_refund_arc20', [7], [8]],
  ['claim_to_arc20_refund_wrapped', [7], [8]],
  ['claim_to_wrapped_refund_wrapped', [7], [8, 9]],
]
const LP: typeof CORE = [
  ['mint_from_wrapped_arc20', [9, 10, 11], [2]],
  ['mint_from_arc20_wrapped', [9, 10, 11], [3]],
  ['mint_from_wrapped_wrapped', [10, 11, 12], [2, 4]],
  ['increase_from_wrapped_arc20', [], [2]],
  ['increase_from_arc20_wrapped', [], [3]],
  ['increase_from_wrapped_wrapped', [], [2, 4]],
  ['collect_to_wrapped_arc20', [5, 6], [7]],
  ['collect_to_arc20_wrapped', [5, 6], [7]],
  ['collect_to_wrapped_wrapped', [5, 6], [7, 8]],
]
const REBALANCE: typeof CORE = [
  ['rebalance_plain_plain_none', [4, 5], []],
  ['rebalance_plain_plain_one', [5, 6], []],
  ['rebalance_plain_plain_both', [6, 7], []],
  ['rebalance_wrapped_plain_none', [5, 6], [2]],
  ['rebalance_wrapped_plain_fund0', [7, 8], [3, 4]],
  ['rebalance_wrapped_plain_fund1', [6, 7], [3]],
  ['rebalance_wrapped_plain_both', [8, 9], [3, 5]],
  ['rebalance_plain_wrapped_none', [5, 6], [2]],
  ['rebalance_plain_wrapped_fund0', [6, 7], [3]],
  ['rebalance_plain_wrapped_fund1', [7, 8], [3, 4]],
  ['rebalance_plain_wrapped_both', [8, 9], [4, 5]],
  ['rebalance_wrapped_wrapped_none', [6, 7], [2, 3]],
  ['rebalance_wrapped_wrapped_one', [8, 9], [3, 4, 5]],
  ['rebalance_wrapped_wrapped_both', [10, 11], [3, 5, 6, 7]],
]

/**
 * Builds constrained freezelist grants for every proof-bearing stack call site.
 *
 * Emits one grant per input slot. AMM slots allow only the configured AMM list;
 * wrapper slots allow the distinct compliance lists in the supplied deployment
 * map. Does not grant unrelated algorithms or access records and makes no calls.
 *
 * @param params The deployment's wrapper mappings and optional program overrides.
 * @returns Grants to combine with blinding grants in `algorithmsAllowed`.
 *
 * @example
 * const grants = shieldSwapFreezelistGrants({
 *   wrapperFreezelists: { 'usdcx_wrapper.aleo': 'usdcx_freezelist.aleo' },
 * })
 */
export function shieldSwapFreezelistGrants(params: ShieldSwapFreezelistGrantsParameters): AlgorithmGrant[] {
  const amm = params.ammFreezelistProgram ?? SHIELD_SWAP_FREEZELIST
  const wrappers = [...new Set(Object.values(params.wrapperFreezelists).filter((value): value is string => value !== null))]
  const grants: AlgorithmGrant[] = []
  for (const [program, matrix] of [
    [params.program ?? SHIELD_SWAP, CORE],
    [params.routerProgram ?? SHIELD_SWAP_ROUTER, SWAP],
    [params.lpRouterProgram ?? SHIELD_SWAP_LP_ROUTER, LP],
    [params.rebalanceRouterProgram ?? SHIELD_SWAP_REBALANCE_ROUTER, REBALANCE],
  ] as const) {
    for (const [fn, ammPositions, wrapperPositions] of matrix) {
      for (const inputPosition of ammPositions) {
        grants.push(freezelistProofGrant({ program, function: fn, inputPosition, freezelistProgram: amm }))
      }
      if (wrappers.length === 0) continue
      for (const inputPosition of wrapperPositions) {
        const grant = freezelistProofGrant({ program, function: fn, inputPosition, freezelistProgram: wrappers[0]! })
        grant.argConstraints = { freezelistProgram: [...wrappers] }
        grants.push(grant)
      }
    }
  }
  return grants
}
