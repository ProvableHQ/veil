import { executeContract, writeContract, type Client, type InputRequest, type TransactionInput } from '@provablehq/veil-core'
import { requireAccount, requirePool, requireSlot } from '../../utils/guards.js'
import { generateFieldNonce, formatMintPositionRequest } from '../../utils/params.js'
import { tryLoadSdk } from '../../utils/sdk.js'
import { derivePositionTokenId } from '../../utils/keys.js'
import { requireFieldOutput } from '../../utils/outputs.js'
import { roundTickToSpacing } from '../../utils/tick-math.js'
import { pickInsertHint } from '../../utils/tick-hints.js'
import type { TokenRoute } from '../../utils/routing.js'
import type { ProofProvider } from '../../utils/proofs.js'
import { SHIELD_SWAP } from '../../constants.js'
import {
  ammProofPair,
  assertPayoutAddress,
  autoSelectSideRecord,
  dispatchLiquidityCall,
  resolveSideRoutes,
  wrapperSenderProof,
} from './internal.js'

/**
 * Parameters for {@link mint}.
 *
 * @property poolKey Pool to provide liquidity to.
 * @property tickLower Lower bound of the range. Rounded down to the pool's
 *   tick spacing automatically.
 * @property tickUpper Upper bound of the range. Rounded down to spacing.
 * @property amount0Desired Raw atomic amount of token0 to deposit (u128).
 * @property amount1Desired Raw atomic amount of token1 to deposit (u128).
 * @property amount0Min Minimum token0 actually taken (slippage guard).
 *   Defaults to 0 — set it for pools with volatile in-range price.
 * @property amount1Min Minimum token1 actually taken. Defaults to 0.
 * @property recipient Position owner — the PositionNFT record's owner.
 *   Required and validated: MUST NOT be the zero address or a program
 *   account of the stack.
 * @property withdrawal Address `collect` pays the position's tokens to,
 *   fixed at mint. Required and validated like `recipient` — there is no
 *   defaulting, so a custodial owner and a cold payout address are both
 *   explicit decisions.
 * @property token0Program Program holding the caller's token0 records.
 *   Optional — defaults to the route's underlying program (wrapped side) or
 *   the program decoded from the token id (plain side).
 * @property token1Program Program holding the caller's token1 records.
 * @property token0Record Explicit record input (plaintext literal, or a
 *   `record` InputRequest for wallet signers — REQUIRED for wallets). A
 *   wrapped side's record is the UNDERLYING asset's record (e.g. a credits
 *   record for wALEO), never a wrapper record.
 * @property token1Record Explicit record input for token1, same rule.
 * @property token0Route Pre-resolved route override for token0 — skips the
 *   on-chain wrapped-ness read (offline/advanced use).
 * @property token1Route Pre-resolved route override for token1.
 * @property proofs Freezelist proof provider for populated freezelists.
 *   Defaults to the empty-tree witness on every proof slot.
 * @property tickLowerHint Explicit insert hint. Defaults to
 *   `pickInsertHint` (best-effort — see its limitation).
 * @property tickUpperHint Explicit insert hint for the upper bound.
 * @property nonce Explicit field nonce. Defaults to crypto-random.
 * @property imports Program sources for dynamic-dispatch dependencies
 *   (`{ 'token.aleo': source }`). The prover cannot discover `IARC20@(...)`
 *   callees statically — pass the involved token programs' sources when
 *   proving locally or via a service that requires them.
 * @property program shield_swap core program override. Defaults to
 *   `shield_swap.aleo`. Router calls always target
 *   `shield_swap_lp_router.aleo`.
 */
export type MintParameters = {
  poolKey: string
  tickLower: number
  tickUpper: number
  amount0Desired: bigint
  amount1Desired: bigint
  amount0Min?: bigint
  amount1Min?: bigint
  recipient: string
  withdrawal: string
  token0Program?: string
  token1Program?: string
  token0Record?: string | InputRequest
  token1Record?: string | InputRequest
  token0Route?: TokenRoute
  token1Route?: TokenRoute
  proofs?: ProofProvider
  tickLowerHint?: number
  tickUpperHint?: number
  nonce?: string
  imports?: Record<string, string>
  program?: string
}

/**
 * The minted position's essentials.
 *
 * @property positionTokenId The position's `token_id` (a public output) —
 *   the key for `getPosition` and later liquidity changes. Known
 *   immediately on the local path; on the wallet path it is derived locally
 *   when `@provablehq/sdk` is installed, and `undefined` otherwise — recover
 *   it from the confirmed transaction or compute it with
 *   `derivePositionTokenId`.
 * @property transactionId The mint transaction's id.
 */
export type MintReturnType = {
  positionTokenId?: string
  transactionId: string
}

/**
 * Mints a new concentrated-liquidity position as a private PositionNFT.
 *
 * Deposits both tokens privately (records in, change back), aligns the tick
 * range to the pool's spacing, computes insert hints, and dispatches on the
 * pair's wrapped-ness: both tokens plain calls the core `mint` directly;
 * any wrapped side routes through `shield_swap_lp_router.aleo`
 * (`mint_from_wrapped_arc20` / `mint_from_arc20_wrapped` /
 * `mint_from_wrapped_wrapped`), where the wrapped side's record slot takes
 * the caller's UNDERLYING record and is followed by that wrapper's
 * freezelist sender proof. The three AMM freezelist proof slots (signer,
 * recipient, withdrawal) default to the empty-tree witness.
 *
 * Signer paths mirror `swap`: local accounts auto-select records and
 * pass literals; wallet accounts must supply both `tokenNRecord` inputs.
 *
 * Hits the network: pool/slot reads, route reads (cached per token), hint
 * reads, record scans, and the transaction. Signs, and on the local path
 * proves locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The range, amounts, both payout addresses, and optional
 *   overrides.
 * @returns The position token id (derived locally on the wallet path when
 *   the WASM peer is present) and transaction id.
 * @throws When `recipient` or `withdrawal` is missing or invalid; when the
 *   pool does not exist; when the range is empty after spacing alignment;
 *   when records are missing (local) or not provided (wallet); and on
 *   transport/proving errors.
 *
 * @example
 * const { positionTokenId } = await mint(client, {
 *   poolKey, tickLower: -62400, tickUpper: -60000,
 *   amount0Desired: 10n ** 18n, amount1Desired: 2_000_000n,
 *   recipient: account.address, withdrawal: account.address,
 * })
 */
export async function mint(client: Client, params: MintParameters): Promise<MintReturnType> {
  const program = params.program ?? SHIELD_SWAP

  // Both payout addresses are deliberate, validated inputs — a mistyped or
  // defaulted address here strands the position or its withdrawals.
  assertPayoutAddress('recipient', params.recipient)
  assertPayoutAddress('withdrawal', params.withdrawal)

  const pool = await requirePool(client, params.poolKey, program)
  const slot = await requireSlot(client, params.poolKey, program)

  // Align the range to the pool's spacing; an empty range would revert.
  const tickLower = roundTickToSpacing(params.tickLower, slot.tick_spacing)
  const tickUpper = roundTickToSpacing(params.tickUpper, slot.tick_spacing)
  if (tickLower >= tickUpper) {
    throw new Error(`Empty tick range after spacing alignment: [${tickLower}, ${tickUpper})`)
  }

  const tickLowerHint =
    params.tickLowerHint ?? (await pickInsertHint(client, { poolKey: params.poolKey, targetTick: tickLower, program }))
  const upperPredecessor =
    params.tickUpperHint ?? (await pickInsertHint(client, { poolKey: params.poolKey, targetTick: tickUpper, program }))
  // The finalize inserts tick_lower before validating the upper hint, so when
  // no initialized tick sits between the bounds, the upper tick's predecessor
  // is the just-inserted lower tick — not the predecessor visible on chain.
  const tickUpperHint =
    params.tickUpperHint === undefined && tickLower > upperPredecessor ? tickLower : upperPredecessor

  const requestInput = {
    pool: params.poolKey,
    tickLower,
    tickUpper,
    amount0Desired: params.amount0Desired,
    amount1Desired: params.amount1Desired,
    amount0Min: params.amount0Min ?? 0n,
    amount1Min: params.amount1Min ?? 0n,
    tickLowerHint,
    tickUpperHint,
  }
  const request = formatMintPositionRequest(requestInput)

  const account = requireAccount(client, 'mint')
  const isLocal = account.type === 'local'
  const nonce = params.nonce ?? generateFieldNonce()

  // Wrapped-ness decides the target transition and which program each
  // side's record comes from.
  const [route0, route1] = await resolveSideRoutes(client, {
    token0Id: pool.token0,
    token1Id: pool.token1,
    program,
    token0Route: params.token0Route,
    token1Route: params.token1Route,
  })

  // Wrapper freezelist proofs prove the SENDER; AMM proofs prove the three
  // mint parties. All default to the empty-tree witness.
  const [senderProof0, senderProof1, signerProofs, recipientProofs, withdrawalProofs] = await Promise.all([
    wrapperSenderProof(params.proofs, route0, account.address),
    wrapperSenderProof(params.proofs, route1, account.address),
    ammProofPair(params.proofs, account.address),
    ammProofPair(params.proofs, params.recipient),
    ammProofPair(params.proofs, params.withdrawal),
  ])

  // Everything after the record slots is identical across all four variants.
  const tail: string[] = [
    params.recipient,
    params.withdrawal,
    request,
    pool.token0,
    pool.token1,
    signerProofs,
    recipientProofs,
    withdrawalProofs,
  ]

  if (isLocal) {
    // Reject InputRequests BEFORE any selection work — an object here must
    // never silently fall through to auto-selection.
    if (typeof params.token0Record === 'object' || typeof params.token1Record === 'object') {
      throw new Error('Local accounts cannot use InputRequests — pass record plaintext literals instead')
    }
    const record0 =
      params.token0Record ?? (await autoSelectSideRecord(client, route0, params.amount0Desired, params.token0Program))
    const record1 =
      params.token1Record ?? (await autoSelectSideRecord(client, route1, params.amount1Desired, params.token1Program))

    const dispatch = dispatchLiquidityCall({
      coreProgram: program,
      coreFunction: 'mint',
      routerPrefix: 'mint_from',
      route0,
      route1,
      record0,
      record1,
      senderProof0,
      senderProof1,
    })

    const result = await executeContract(client, {
      program: dispatch.program,
      function: dispatch.functionName,
      imports: params.imports,
      inputs: [nonce, ...dispatch.recordInputs, ...tail],
    })
    const positionTokenId = requireFieldOutput(result.outputs, dispatch.functionName)
    return { positionTokenId, transactionId: result.transactionId }
  }

  if (params.token0Record === undefined || params.token1Record === undefined) {
    throw new Error(
      'Wallet accounts must provide token0Record and token1Record (record InputRequests or granted plaintext)',
    )
  }
  const dispatch = dispatchLiquidityCall({
    coreProgram: program,
    coreFunction: 'mint',
    routerPrefix: 'mint_from',
    route0,
    route1,
    record0: params.token0Record,
    record1: params.token1Record,
    senderProof0,
    senderProof1,
  })
  const inputs: TransactionInput[] = [nonce, ...dispatch.recordInputs, ...tail]
  // Best-effort id: every preimage field is client-known, so when the
  // optional WASM peer is present the id is computable ahead of submission.
  // A derivation fault (broken WASM asset, CSP, version skew) degrades to
  // undefined rather than blocking a submittable transaction.
  const positionTokenId = (await tryLoadSdk())
    ? await derivePositionTokenId({ request: requestInput, recipient: params.recipient, nonce }).catch(() => undefined)
    : undefined
  const transactionId = await writeContract(client, {
    program: dispatch.program,
    function: dispatch.functionName,
    imports: params.imports ? Object.keys(params.imports) : undefined,
    inputs,
  })
  return { positionTokenId, transactionId }
}
