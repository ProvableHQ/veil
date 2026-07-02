import { executeContract, writeContract, type Client, type TransactionInput } from '@veil/core'
import type { SwapHandle } from '../../types.js'
import { getSwapOutput } from '../reads/getSwapOutput.js'
import { blindingFactorResolveRequest, blindedAddressResolveRequest } from '../../wallet-requests.js'

/**
 * The swap output is not in the mapping yet (request not finalized) —
 * retryable. Also thrown when the output was already claimed, which is not
 * retryable; a claim consumes the entry, so a second claim of the same
 * handle sees the same absence.
 */
export class SwapOutputNotFinalizedError extends Error {
  constructor(swapId: string) {
    super(
      `swap_outputs[${swapId}] is empty — the request transaction has not finalized yet ` +
        '(retry shortly), or this output was already claimed.',
    )
    this.name = 'SwapOutputNotFinalizedError'
  }
}

/**
 * Parameters for {@link claimSwapOutputPrivate}.
 *
 * @property handle The {@link SwapHandle} from `swapPrivate`. Local-signer
 *   handles are complete; wallet-path handles need `swapId` and
 *   `blindedAddress` resolved from the confirmed request transaction first.
 * @property program shield_swap program override. Defaults to the handle's
 *   program.
 */
export type ClaimSwapOutputPrivateParameters = {
  handle: SwapHandle
  program?: string
}

/**
 * The claim's essentials.
 *
 * @property transactionId The claim transaction's id.
 * @property amountOut Raw atomic amount received (u128), as computed on
 *   chain.
 * @property amountRemaining Raw atomic input refund (u128) — non-zero when
 *   the swap partially filled at the price limit.
 */
export type ClaimSwapOutputPrivateReturnType = {
  transactionId: string
  amountOut: bigint
  amountRemaining: bigint
}

/**
 * Claims a private swap's output — phase two of the lifecycle.
 *
 * Reads the chain-computed result from `swap_outputs` (never an off-chain
 * service — these amounts gate money movement), proves ownership of the
 * blinded identity, and submits `claim_swap_output_private`. The output and
 * any refund arrive as private records owned by the signer; the mapping
 * entry is consumed.
 *
 * Signer paths mirror `swapPrivate`: a local account passes the handle's
 * literal `blindingFactor`; a wallet account gets resolve-mode derived
 * requests targeting the handle's `blindedAddress` and re-derives the factor
 * itself.
 *
 * Hits the network: one mapping read plus the transaction. Signs, and on the
 * local path proves locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The handle to claim.
 * @returns The claim transaction id and the chain-computed amounts.
 * @throws {SwapOutputNotFinalizedError} When the output is not readable yet
 *   (retry) or was already claimed. Also throws when the handle is missing
 *   the fields its signer path needs, and on transport/proving errors.
 *
 * @example
 * const { amountOut } = await claimSwapOutputPrivate(client, { handle })
 */
export async function claimSwapOutputPrivate(
  client: Client,
  params: ClaimSwapOutputPrivateParameters,
): Promise<ClaimSwapOutputPrivateReturnType> {
  const { handle } = params
  const program = params.program ?? handle.program

  if (!handle.swapId) {
    throw new Error(
      'handle.swapId is not set — on the wallet path, resolve it from the confirmed ' +
        'request transaction (first public output of the swap_private transition) before claiming.',
    )
  }

  // Trust-critical read: the amounts the claim moves come from the chain.
  const out = await getSwapOutput(client, { swapId: handle.swapId, program })
  if (!out) throw new SwapOutputNotFinalizedError(handle.swapId)

  const account = (client as { account?: { type: string } }).account
  if (!account) throw new Error('claimSwapOutputPrivate requires a wallet client with an account')
  const isLocal = account.type === 'local'

  // Everything after the two blinding slots, verbatim from chain state.
  const tail: string[] = [
    handle.swapId,
    out.token_in,
    out.token_out,
    `${out.amount_out}u128`,
    `${out.amount_remaining}u128`,
  ]

  if (isLocal) {
    if (!handle.blindingFactor || !handle.blindedAddress) {
      throw new Error('Local claims need handle.blindingFactor and handle.blindedAddress (set by swapPrivate on the local path)')
    }
    const result = await executeContract(client, {
      program,
      function: 'claim_swap_output_private',
      inputs: [handle.blindingFactor, handle.blindedAddress, ...tail],
    })
    return { transactionId: result.transactionId, amountOut: out.amount_out, amountRemaining: out.amount_remaining }
  }

  if (!handle.blindedAddress) {
    throw new Error(
      'handle.blindedAddress is not set — recover it from the confirmed request transaction ' +
        "(or the indexer's swap.recipient) so the wallet can re-derive the blinding factor.",
    )
  }
  const inputs: TransactionInput[] = [
    blindingFactorResolveRequest(handle.blindedAddress, program),
    blindedAddressResolveRequest(handle.blindedAddress, program),
    ...tail,
  ]
  const transactionId = await writeContract(client, { program, function: 'claim_swap_output_private', inputs })
  return { transactionId, amountOut: out.amount_out, amountRemaining: out.amount_remaining }
}
