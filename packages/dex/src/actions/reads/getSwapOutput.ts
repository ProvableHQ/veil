import type { Client } from '@veil/core'
import { toSwapOutput, type SwapOutput } from '../../generated/shield_swap.js'
import { readStructMapping } from './internal.js'

/**
 * Parameters for {@link getSwapOutput}.
 *
 * @property swapId Swap id as an Aleo field literal (returned by
 *   `swap_private` as its first output), including the `field` suffix.
 * @property program Program to read from. Defaults to the generated
 *   `DEFAULT_PROGRAM`.
 */
export type GetSwapOutputParameters = {
  swapId: string
  program?: string
}

export type GetSwapOutputReturnType = SwapOutput | null

/**
 * Reads a computed swap result from the on-chain `swap_outputs` mapping.
 *
 * Between the two phases of a private swap the chain computes the outcome and
 * stores it here: `amount_out` and `amount_remaining` (both u128 `bigint`) are
 * the values `claim_swap_output_private` MUST be called with. Read them from
 * chain — never from an off-chain service — because they gate money movement.
 *
 * `null` has two meanings the caller must distinguish by context: the request
 * transaction has not finalized yet (retry), or the output was already claimed
 * (the claim consumes the entry).
 *
 * Hits the network: one node request via the client's transport.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The swap id to look up, and optionally the program to read from.
 * @returns The decoded output, or `null` when the id is not in the mapping
 *   (not yet finalized, or already claimed).
 * @throws A transport error when the node is unreachable or rejects the
 *   request, and a decode error when the value does not parse as a `SwapOutput`.
 *
 * @example
 * const out = await getSwapOutput(client, { swapId })
 * if (out) await claimSwapOutputPrivate(client, { handle, amountOut: out.amount_out })
 */
export async function getSwapOutput(client: Client, params: GetSwapOutputParameters): Promise<GetSwapOutputReturnType> {
  return readStructMapping(client, params.program, 'swap_outputs', params.swapId, toSwapOutput)
}
