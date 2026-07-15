import { executeContract, writeContract, type Client, type TransactionInput } from '@provablehq/veil-core'
import type { MultiHopSwapHandle } from './swapMultiHop.js'
import { getSwapOutput } from '../reads/getSwapOutput.js'
import { SwapOutputNotFinalizedError } from './claimSwapOutput.js'
import { requireAccount } from '../../utils/guards.js'
import { blindingFactorResolveRequest, blindedAddressResolveRequest } from '../../utils/blinding/requests.js'

/**
 * Parameters for {@link claimMultiHopOutput}.
 *
 * @property handle The {@link MultiHopSwapHandle} from `swapMultiHop`.
 *   Local-signer handles are complete; wallet-path handles need `swapId` and
 *   `blindedAddress` resolved from the confirmed request transaction (or
 *   computed with `deriveMultiHopSwapId`) first.
 * @property imports Program sources for dynamic-dispatch dependencies
 *   (`{ 'token.aleo': source }`) — the claim transfers up to four tokens
 *   (output plus refunds), so pass every involved token program's source
 *   when proving locally or via a service that requires them.
 * @property program shield_swap program override. Defaults to the handle's
 *   program.
 */
export type ClaimMultiHopOutputParameters = {
  handle: MultiHopSwapHandle
  imports?: Record<string, string>
  program?: string
}

/**
 * The multi-hop claim's essentials.
 *
 * @property transactionId The claim transaction's id.
 * @property amountOut Raw atomic amount of the final output token received
 *   (u128), as computed on chain.
 * @property amountRemaining Raw atomic input refund (u128) — non-zero when
 *   the route partially filled at a price limit.
 * @property hopRefunds Intermediate-token refunds from partial fills on
 *   later hops, zero-amount padding slots filtered out. Each entry is the
 *   refunded token id and its raw atomic amount (u128).
 */
export type ClaimMultiHopOutputReturnType = {
  transactionId: string
  amountOut: bigint
  amountRemaining: bigint
  hopRefunds: Array<{ tokenId: string; amount: bigint }>
}

/**
 * Claims a private multi-hop swap's output — phase two of the lifecycle.
 *
 * Reads the chain-computed result from `swap_outputs` (never an off-chain
 * service — these amounts gate money movement), proves ownership of the
 * blinded identity, and submits `claim_multi_hop_output`. The output and any
 * refunds arrive as private records owned by the signer; the mapping entry
 * is consumed.
 *
 * Signer paths mirror `claimSwapOutput`: a local account passes the handle's
 * literal `blindingFactor`; a wallet account gets resolve-mode derived
 * requests targeting the handle's `blindedAddress` and re-derives the factor
 * itself.
 *
 * Hits the network: one mapping read plus the transaction. Signs, and on the
 * local path proves locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The handle to claim.
 * @returns The claim transaction id, the chain-computed output, and any
 *   per-hop refunds.
 * @throws {SwapOutputNotFinalizedError} When the output is not readable yet
 *   (retry) or was already claimed. Also throws when the handle is missing
 *   the fields its signer path needs, and on transport/proving errors.
 *
 * @example
 * const { amountOut, hopRefunds } = await claimMultiHopOutput(client, { handle })
 */
export async function claimMultiHopOutput(
  client: Client,
  params: ClaimMultiHopOutputParameters,
): Promise<ClaimMultiHopOutputReturnType> {
  const { handle } = params
  const program = params.program ?? handle.program

  if (!handle.swapId) {
    throw new Error(
      'handle.swapId is not set — on the wallet path, resolve it from the confirmed request ' +
        'transaction (first public output of the swap_multi_hop transition), or compute it with ' +
        'deriveMultiHopSwapId once the blinded address is known.',
    )
  }

  // Trust-critical read: the amounts the claim moves come from the chain.
  const out = await getSwapOutput(client, { swapId: handle.swapId, program })
  if (!out) throw new SwapOutputNotFinalizedError(handle.swapId)

  const isLocal = requireAccount(client, 'claimMultiHopOutput').type === 'local'

  // Everything after the two blinding slots, verbatim from chain state —
  // the finalize asserts each field against swap_outputs[swap_id].
  const tail: string[] = [
    handle.swapId,
    out.token_in,
    out.token_out,
    `${out.amount_out}u128`,
    `${out.amount_remaining}u128`,
    out.token_in_1,
    `${out.amount_remaining_1}u128`,
    out.token_in_2,
    `${out.amount_remaining_2}u128`,
  ]

  // Per-hop refunds land in the token_in_1/2 slots; zero entries are padding.
  const hopRefunds = [
    { tokenId: out.token_in_1, amount: out.amount_remaining_1 },
    { tokenId: out.token_in_2, amount: out.amount_remaining_2 },
  ].filter((r) => r.amount > 0n)

  if (isLocal) {
    if (!handle.blindingFactor || !handle.blindedAddress) {
      throw new Error(
        'Local claims need handle.blindingFactor and handle.blindedAddress (set by swapMultiHop on the local path)',
      )
    }
    const result = await executeContract(client, {
      program,
      function: 'claim_multi_hop_output',
      imports: params.imports,
      inputs: [handle.blindingFactor, handle.blindedAddress, ...tail],
    })
    return {
      transactionId: result.transactionId,
      amountOut: out.amount_out,
      amountRemaining: out.amount_remaining,
      hopRefunds,
    }
  }

  if (!handle.blindedAddress) {
    throw new Error(
      'handle.blindedAddress is not set — recover it from the confirmed request transaction ' +
        'so the wallet can re-derive the blinding factor.',
    )
  }
  const inputs: TransactionInput[] = [
    blindingFactorResolveRequest(handle.blindedAddress, program),
    blindedAddressResolveRequest(handle.blindedAddress, program),
    ...tail,
  ]
  const transactionId = await writeContract(client, {
    program,
    function: 'claim_multi_hop_output',
    imports: params.imports ? Object.keys(params.imports) : undefined,
    inputs,
  })
  return { transactionId, amountOut: out.amount_out, amountRemaining: out.amount_remaining, hopRefunds }
}
