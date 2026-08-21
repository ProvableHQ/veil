import type { Client } from '@provablehq/veil-core'
import {
  toSwapExecutionHeadersMappingValue,
  toSwapExecutionHopsMappingValue,
  type SwapExecutionHeader,
  type HopExecution,
} from '../../generated/shield_swap.js'
import { readDecodedMapping } from './internal.js'

/**
 * Parameters for {@link getSwapExecution}.
 *
 * @property swapId Swap id as an Aleo field literal (returned by `swap` and
 *   `swapMultiHop`), including the `field` suffix.
 * @property program Program to read from. Defaults to `shield_swap.aleo`.
 */
export type GetSwapExecutionParameters = {
  swapId: string
  program?: string
}

/**
 * One executed hop with its derived LP fee.
 *
 * @property lp_fee The liquidity providers' share of the hop's fee, derived as
 *   `fee_paid - protocol_fee` (u128 `bigint`, in the hop's input token).
 */
export type SwapExecutionHop = HopExecution & { lp_fee: bigint }

/**
 * The execution receipt: the header plus one entry per hop, in hop order.
 *
 * @property header The `executed_height` and `hop_count` stored at execution.
 * @property hops Per-hop receipts — pool, direction, input, output, gross fee,
 *   protocol fee, final price, liquidity, and tick — with the derived LP fee.
 */
export type GetSwapExecutionReturnType = {
  header: SwapExecutionHeader
  hops: SwapExecutionHop[]
} | null

/**
 * Reads a swap's execution receipt from the on-chain `swap_execution_headers`
 * and `swap_execution_hops` mappings.
 *
 * The chain writes the receipt when the swap request finalizes and keeps it
 * after the claim — unlike `swap_outputs`, which the claim consumes — so a
 * settled trade's exact fills, fees, and end-of-hop prices stay auditable.
 * Swaps executed before the edition-1 upgrade have no receipt; a caller
 * needing those falls back to transaction history.
 *
 * Hits the network: one header read plus one concurrent read per hop.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The swap id to look up, and optionally the program to read from.
 * @returns The header and per-hop receipts, or `null` when the swap has no
 *   receipt (pre-upgrade, or the request has not finalized).
 * @throws When a hop named by the header is absent — the deployment does not
 *   match the generated ABI, or the node returned inconsistent state.
 *
 * @example
 * const receipt = await getSwapExecution(client, { swapId })
 * const totalLpFee = receipt?.hops.reduce((sum, hop) => sum + hop.lp_fee, 0n)
 */
export async function getSwapExecution(
  client: Client,
  params: GetSwapExecutionParameters,
): Promise<GetSwapExecutionReturnType> {
  const header = await readDecodedMapping(
    client,
    params.program,
    'swap_execution_headers',
    params.swapId,
    toSwapExecutionHeadersMappingValue,
  )
  if (!header) return null

  // Every hop key is known upfront from hop_count, so the reads run concurrently.
  const rawHops = await Promise.all(
    Array.from({ length: header.hop_count }, (_unused, hopIndex) => {
      // The hop key is the SwapExecutionKey struct, queried as a plaintext literal.
      const key = `{ swap_id: ${params.swapId}, hop_index: ${hopIndex}u8 }`
      return readDecodedMapping(client, params.program, 'swap_execution_hops', key, toSwapExecutionHopsMappingValue)
    }),
  )

  const hops: SwapExecutionHop[] = rawHops.map((hop, hopIndex) => {
    if (!hop) {
      throw new Error(
        `swap_execution_hops is missing hop ${hopIndex} of ${header.hop_count} for ${params.swapId} — ` +
          'the header names a hop the node did not return.',
      )
    }
    return { ...hop, lp_fee: hop.fee_paid - hop.protocol_fee }
  })
  return { header, hops }
}
