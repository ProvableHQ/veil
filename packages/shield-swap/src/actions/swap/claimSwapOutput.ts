import { executeContract, writeContract, type Client, type TransactionInput } from '@provablehq/veil-core'
import type { SwapHandle } from './swap.js'
import type { MultiHopSwapHandle } from './swapMultiHop.js'
import { getSwapOutput } from '../reads/getSwapOutput.js'
import { requireAccount } from '../../utils/guards.js'
import { markClaimedQuietly } from '../../utils/blinding/tracking.js'
import type { BlindedIdentityStore } from '../../utils/blinding/store.js'
import { blindingFactorResolveRequest, blindedAddressResolveRequest } from '../../utils/blinding/requests.js'
import { resolveTokenRoute } from '../../utils/routing.js'
import { resolveProofPair, formatMerkleProofPair, type ProofProvider } from '../../utils/proofs.js'
import { SHIELD_SWAP_ROUTER, SHIELD_SWAP_FREEZELIST } from '../../constants.js'

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
 * Parameters for {@link claimSwapOutput}.
 *
 * @property blindedIdentities Store to mark the identity `claimed` in once the
 *   claim confirms. Supplied by `shieldSwapActions` when configured. A store
 *   that does not hold the handle's `blindedAddress` is left alone, so a
 *   wallet-derived identity is a no-op. A write failure here is reported and
 *   swallowed rather than failing a claim whose proceeds already landed —
 *   `reconcileSwapHistory` can recover the status from the claim call.
 * @property handle The {@link SwapHandle} from `swap` or the
 *   {@link MultiHopSwapHandle} from `swapMultiHop` — the claim is unified
 *   across both. Local-signer handles are complete; wallet-path handles need
 *   `swapId` and `blindedAddress` resolved from the confirmed request
 *   transaction first.
 * @property proofs Freezelist witness provider for populated freezelists —
 *   the claim proves the signer against the AMM freezelist, and against each
 *   wrapped token's wrapper list when unwrapping. Defaults to the empty-tree
 *   witness, which the contracts accept while the lists are empty.
 * @property imports Program sources for dynamic-dispatch dependencies
 *   (`{ 'token.aleo': source }`). The prover cannot discover dynamic callees
 *   statically — pass the involved token programs' sources when proving
 *   locally or via a service that requires them.
 * @property program Core AMM program override. Defaults to the handle's
 *   program.
 * @property routerProgram Swap router override for wrapped-claim dispatch.
 *   Defaults to `shield_swap_router.aleo`.
 */
export type ClaimSwapOutputParameters = {
  handle: SwapHandle | MultiHopSwapHandle
  blindedIdentities?: BlindedIdentityStore
  proofs?: ProofProvider
  imports?: Record<string, string>
  program?: string
  routerProgram?: string
}

/**
 * The claim's essentials.
 *
 * @property transactionId The claim transaction's id.
 * @property amountOut Raw atomic amount received (u128), as computed on
 *   chain. Paid in the UNDERLYING asset when the output token is wrapped.
 * @property amountRemaining Raw atomic input refund (u128) — non-zero when
 *   the swap partially filled at a price limit. Paid in the underlying asset
 *   when the input token is wrapped. `0n` when the swap filled completely and
 *   the claim used a no-refund transition (no refund record is produced).
 */
export type ClaimSwapOutputReturnType = {
  transactionId: string
  amountOut: bigint
  amountRemaining: bigint
}

/**
 * Claims a private swap's output — phase two of the lifecycle, for single
 * and multi-hop swaps alike.
 *
 * Reads the chain-computed result from `swap_outputs` (never an off-chain
 * service — these amounts gate money movement), resolves the wrapped-ness of
 * the output and refund tokens, proves ownership of the blinded identity,
 * and dispatches to the matching claim transition. A zero stored remainder
 * selects a no-refund transition — `claim_swap_output_no_refund` on the core
 * AMM when both tokens are plain, or the router's `claim_to_arc20_no_refund` /
 * `claim_to_wrapped_no_refund` when either side is wrapped — which takes no
 * `amount_remaining` input and produces no refund record. A nonzero remainder
 * selects `claim_swap_output` on the core AMM when both tokens are plain, or
 * the router's `claim_to_wrapped_refund_arc20` / `claim_to_arc20_refund_wrapped`
 * / `claim_to_wrapped_refund_wrapped` when either side is wrapped. Either way
 * the router unwraps in the same transaction, so the caller always receives
 * UNDERLYING records (wrappers stay invisible). The mapping entry is consumed.
 *
 * Signer paths mirror `swap`: a local account passes the handle's literal
 * `blindingFactor`; a wallet account gets resolve-mode derived requests
 * targeting the handle's `blindedAddress` and re-derives the factor itself.
 *
 * Hits the network: one mapping read, route reads (cached), and the
 * transaction. Signs, and on the local path proves locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The handle to claim.
 * @returns The claim transaction id and the chain-computed amounts.
 * @throws {SwapOutputNotFinalizedError} When the output is not readable yet
 *   (retry) or was already claimed. Also throws when the handle is missing
 *   the fields its signer path needs, and on transport/proving errors.
 *
 * @example
 * const { amountOut } = await claimSwapOutput(client, { handle })
 */
export async function claimSwapOutput(
  client: Client,
  params: ClaimSwapOutputParameters,
): Promise<ClaimSwapOutputReturnType> {
  const { handle } = params
  const program = params.program ?? handle.program
  const routerProgram = params.routerProgram ?? SHIELD_SWAP_ROUTER

  if (!handle.swapId) {
    throw new Error(
      'handle.swapId is not set — on the wallet path, resolve it from the confirmed ' +
        'request transaction (the public swap-id output of the request transition) before claiming.',
    )
  }

  // Trust-critical read: the amounts the claim moves come from the chain.
  const out = await getSwapOutput(client, { swapId: handle.swapId, program })
  if (!out) throw new SwapOutputNotFinalizedError(handle.swapId)

  const account = requireAccount(client, 'claimSwapOutput')
  const isLocal = account.type === 'local'

  // Wrapped-ness of the output and the refund (the input token) picks the
  // claim transition; on-chain mappings are the routing truth, so resolve
  // from the SwapOutput entry rather than trusting persisted handle flags.
  const outRoute = await resolveTokenRoute(client, { tokenId: out.token_out, program })
  const refundRoute = await resolveTokenRoute(client, { tokenId: out.token_in, program })

  // Every claim path proves the signer against the AMM freezelist; wrapped
  // sides additionally prove the receiver against the wrapper's list.
  const ammProof = formatMerkleProofPair(
    await resolveProofPair(params.proofs, {
      list: 'amm',
      program: SHIELD_SWAP_FREEZELIST,
      subject: account.address,
    }),
  )
  const receiverProof = async (wrapperProgram: string): Promise<string> =>
    formatMerkleProofPair(
      await resolveProofPair(params.proofs, {
        list: 'wrapper',
        program: wrapperProgram,
        subject: account.address,
      }),
    )

  // Dispatch on two axes: whether the swap left an input remainder, then the
  // (output, refund) wrapped-ness. A zero remainder selects the no-refund
  // transitions — no amount_remaining input, no refund record in the result.
  // The chain re-checks the stored remainder and rejects a nonzero one.
  const noRefund = out.amount_remaining === 0n
  let targetProgram: string
  let fn: string
  const proofTail: string[] = [ammProof]
  if (noRefund) {
    if (outRoute.wrapped) {
      // Output unwraps via the router regardless of the input's wrapped-ness.
      targetProgram = routerProgram
      fn = 'claim_to_wrapped_no_refund'
      proofTail.push(await receiverProof(outRoute.wrapperProgram))
    } else if (refundRoute.wrapped) {
      // Plain output but wrapped input: the router variant asserts the pairing.
      targetProgram = routerProgram
      fn = 'claim_to_arc20_no_refund'
    } else {
      targetProgram = program
      fn = 'claim_swap_output_no_refund'
    }
  } else if (outRoute.wrapped && refundRoute.wrapped) {
    targetProgram = routerProgram
    fn = 'claim_to_wrapped_refund_wrapped'
    proofTail.push(await receiverProof(outRoute.wrapperProgram), await receiverProof(refundRoute.wrapperProgram))
  } else if (outRoute.wrapped) {
    targetProgram = routerProgram
    fn = 'claim_to_wrapped_refund_arc20'
    proofTail.push(await receiverProof(outRoute.wrapperProgram))
  } else if (refundRoute.wrapped) {
    targetProgram = routerProgram
    fn = 'claim_to_arc20_refund_wrapped'
    proofTail.push(await receiverProof(refundRoute.wrapperProgram))
  } else {
    targetProgram = program
    fn = 'claim_swap_output'
  }

  // Everything after the two blinding slots, verbatim from chain state, then
  // the proof arrays. The no-refund transitions take no amount_remaining slot.
  const tail: string[] = [
    handle.swapId,
    out.token_in,
    out.token_out,
    `${out.amount_out}u128`,
    ...(noRefund ? [] : [`${out.amount_remaining}u128`]),
    ...proofTail,
  ]

  if (isLocal) {
    if (!handle.blindingFactor || !handle.blindedAddress) {
      throw new Error(
        'Local claims need handle.blindingFactor and handle.blindedAddress (set by the swap on the local path)',
      )
    }
    const result = await executeContract(client, {
      program: targetProgram,
      function: fn,
      imports: params.imports,
      inputs: [handle.blindingFactor, handle.blindedAddress, ...tail],
    })
    if (params.blindedIdentities) {
      await markClaimedQuietly(params.blindedIdentities, handle.blindedAddress)
    }
    return { transactionId: result.transactionId, amountOut: out.amount_out, amountRemaining: out.amount_remaining }
  }

  if (!handle.blindedAddress) {
    throw new Error(
      'handle.blindedAddress is not set — recover it from the confirmed request transaction ' +
        "(or the API's swap.recipient) so the wallet can re-derive the blinding factor.",
    )
  }
  // The derivation scope is the CORE program even for router-submitted
  // claims — the blinding scheme and its membership mapping live on the AMM.
  const inputs: TransactionInput[] = [
    blindingFactorResolveRequest(handle.blindedAddress, program),
    blindedAddressResolveRequest(handle.blindedAddress, program),
    ...tail,
  ]
  const transactionId = await writeContract(client, {
    program: targetProgram,
    function: fn,
    imports: params.imports ? Object.keys(params.imports) : undefined,
    inputs,
  })
  if (params.blindedIdentities) {
    await markClaimedQuietly(params.blindedIdentities, handle.blindedAddress)
  }
  return { transactionId, amountOut: out.amount_out, amountRemaining: out.amount_remaining }
}
