import { executeContract, writeContract, type Client, type InputRequest, type TransactionInput } from '@provablehq/veil-core'
import { resolvePositionRecord, positionTokenIdFromPlaintext } from '../../utils/records.js'
import { requireAccount, requirePool } from '../../utils/guards.js'
import { pickInsertHint } from '../../utils/tick-hints.js'
import type { TokenRoute } from '../../utils/routing.js'
import type { ProofProvider } from '../../utils/proofs.js'
import { SHIELD_SWAP } from '../../constants.js'
import { autoSelectSideRecord, dispatchLiquidityCall, resolveSideRoutes, wrapperSenderProof } from './internal.js'

/**
 * Parameters for {@link increaseLiquidity}.
 *
 * @property poolKey Pool the position belongs to.
 * @property amount0Desired Raw atomic token0 to add (u128).
 * @property amount1Desired Raw atomic token1 to add (u128).
 * @property amount0Min Minimum token0 actually taken. Defaults to 0.
 * @property amount1Min Minimum token1 actually taken. Defaults to 0.
 * @property positionTokenId Which position to grow, by `token_id`. Optional
 *   on the local path (first unspent position for the pool is used);
 *   ignored when `positionRecord` is given.
 * @property positionRecord Explicit PositionNFT record input (plaintext
 *   literal, or a `record` InputRequest for wallet signers — REQUIRED for
 *   wallets, along with both token records).
 * @property token0Program Program holding the caller's token0 records.
 *   Optional — defaults to the route's underlying program (wrapped side) or
 *   the program decoded from the token id (plain side).
 * @property token1Program Program holding the caller's token1 records.
 * @property token0Record Explicit token0 record input. A wrapped side's
 *   record is the UNDERLYING asset's record, never a wrapper record.
 * @property token1Record Explicit token1 record input, same rule.
 * @property token0Route Pre-resolved route override for token0 — skips the
 *   on-chain wrapped-ness read (offline/advanced use).
 * @property token1Route Pre-resolved route override for token1.
 * @property proofs Freezelist proof provider for populated freezelists.
 *   Defaults to the empty-tree witness on the wrapped sides' sender-proof
 *   slots (the only proof slots this transition has).
 * @property tickLowerHint Explicit hint override; defaults to
 *   `pickInsertHint` for the position's own bounds.
 * @property tickUpperHint Explicit hint override.
 * @property imports Program sources for dynamic-dispatch dependencies
 *   (`{ 'token.aleo': source }`). The prover cannot discover `IARC20@(...)`
 *   callees statically — pass the involved token programs' sources when
 *   proving locally or via a service that requires them.
 * @property program shield_swap core program override. Defaults to
 *   `shield_swap.aleo`. Router calls always target
 *   `shield_swap_lp_router.aleo`.
 */
export type IncreaseLiquidityParameters = {
  poolKey: string
  amount0Desired: bigint
  amount1Desired: bigint
  amount0Min?: bigint
  amount1Min?: bigint
  positionTokenId?: string
  positionRecord?: string | InputRequest
  token0Program?: string
  token1Program?: string
  token0Record?: string | InputRequest
  token1Record?: string | InputRequest
  token0Route?: TokenRoute
  token1Route?: TokenRoute
  proofs?: ProofProvider
  tickLowerHint?: number
  tickUpperHint?: number
  imports?: Record<string, string>
  program?: string
}

/**
 * The increase's essentials.
 *
 * @property positionTokenId The grown position's `token_id` (a public
 *   output on the local path; on the wallet path, echoes the
 *   caller-supplied `positionTokenId` — the id is stable across position
 *   operations — and is `undefined` when only `positionRecord` was given).
 * @property transactionId The transaction's id.
 */
export type IncreaseLiquidityReturnType = {
  positionTokenId?: string
  transactionId: string
}

/**
 * Adds liquidity to an existing position, privately.
 *
 * Consumes the PositionNFT record plus two token records and re-issues them
 * (updated NFT, change records). The position's tick range is fixed at mint
 * — this only deepens it. Dispatches on the pair's wrapped-ness like
 * {@link mint}: both plain calls the core `increase_liquidity` directly;
 * any wrapped side routes through `shield_swap_lp_router.aleo`
 * (`increase_from_wrapped_arc20` / `increase_from_arc20_wrapped` /
 * `increase_from_wrapped_wrapped`), where the wrapped side's record slot
 * takes the caller's UNDERLYING record followed by that wrapper's
 * freezelist sender proof.
 *
 * Signer paths mirror `mint`: local accounts auto-select the position and
 * token records; wallet accounts must supply all three record inputs
 * explicitly.
 *
 * Hits the network: pool read, route reads (cached per token), record
 * scans, hint reads, and the transaction. Signs, and on the local path
 * proves locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The amounts and optional overrides.
 * @returns The position token id (echoed from the caller on the wallet
 *   path) and transaction id.
 * @throws When the pool or position is missing; when records are missing
 *   (local) or not provided (wallet); and on transport/proving errors.
 *
 * @example
 * await increaseLiquidity(client, {
 *   poolKey, amount0Desired: 10n ** 17n, amount1Desired: 200_000n,
 * })
 */
export async function increaseLiquidity(
  client: Client,
  params: IncreaseLiquidityParameters,
): Promise<IncreaseLiquidityReturnType> {
  const program = params.program ?? SHIELD_SWAP

  const pool = await requirePool(client, params.poolKey, program)

  const account = requireAccount(client, 'increaseLiquidity')
  const isLocal = account.type === 'local'

  const [route0, route1] = await resolveSideRoutes(client, {
    token0Id: pool.token0,
    token1Id: pool.token1,
    program,
    token0Route: params.token0Route,
    token1Route: params.token1Route,
  })

  // The only proof slots on increase are the wrapped sides' sender proofs.
  const [senderProof0, senderProof1] = await Promise.all([
    wrapperSenderProof(params.proofs, route0, account.address),
    wrapperSenderProof(params.proofs, route1, account.address),
  ])

  // Everything after the record slots is identical across all four variants.
  const tail = (tickLowerHint: number, tickUpperHint: number): string[] => [
    `${params.amount0Desired}u128`,
    `${params.amount1Desired}u128`,
    `${params.amount0Min ?? 0n}u128`,
    `${params.amount1Min ?? 0n}u128`,
    pool.token0,
    pool.token1,
    `${tickLowerHint}i32`,
    `${tickUpperHint}i32`,
  ]

  if (isLocal) {
    // Token records must be literals on the local path; resolvePositionRecord
    // applies the same rule to the position record below.
    if (typeof params.token0Record === 'object' || typeof params.token1Record === 'object') {
      throw new Error('Local accounts cannot use InputRequests — pass record plaintext literals instead')
    }

    // Resolve the position for its record AND its tick bounds (→ hints).
    // PositionNFTs live in the core program regardless of dispatch.
    const {
      plaintext: positionPlaintext,
      tickLower,
      tickUpper,
    } = await resolvePositionRecord(client, {
      positionRecord: params.positionRecord,
      program,
      poolKey: params.poolKey,
      tokenId: params.positionTokenId,
    })

    const tickLowerHint =
      params.tickLowerHint ??
      (tickLower !== undefined
        ? await pickInsertHint(client, { poolKey: params.poolKey, targetTick: tickLower, program })
        : undefined)
    const tickUpperHint =
      params.tickUpperHint ??
      (tickUpper !== undefined
        ? await pickInsertHint(client, { poolKey: params.poolKey, targetTick: tickUpper, program })
        : undefined)
    if (tickLowerHint === undefined || tickUpperHint === undefined) {
      throw new Error('tickLowerHint/tickUpperHint are required when passing positionRecord explicitly')
    }

    const record0 =
      params.token0Record ?? (await autoSelectSideRecord(client, route0, params.amount0Desired, params.token0Program))
    const record1 =
      params.token1Record ?? (await autoSelectSideRecord(client, route1, params.amount1Desired, params.token1Program))

    const dispatch = dispatchLiquidityCall({
      coreProgram: program,
      coreFunction: 'increase_liquidity',
      routerPrefix: 'increase_from',
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
      inputs: [positionPlaintext, ...dispatch.recordInputs, ...tail(tickLowerHint, tickUpperHint)],
    })
    // Each wrapped side prepends an underlying change record, shifting the
    // public token_id output right — the dispatch knows the index.
    const positionTokenId = result.outputs[dispatch.tokenIdIndex]
    if (!positionTokenId?.endsWith('field')) {
      throw new Error(`Unexpected ${dispatch.functionName} output shape: ${JSON.stringify(result.outputs)}`)
    }
    return { positionTokenId, transactionId: result.transactionId }
  }

  // Wallet path: all three records come from the dapp; hints must be explicit
  // or derivable from nothing — require them with the records.
  if (params.positionRecord === undefined || params.token0Record === undefined || params.token1Record === undefined) {
    throw new Error('Wallet accounts must provide positionRecord, token0Record, and token1Record')
  }
  if (params.tickLowerHint === undefined || params.tickUpperHint === undefined) {
    throw new Error('Wallet accounts must provide tickLowerHint/tickUpperHint (the position bounds are wallet-side)')
  }
  const dispatch = dispatchLiquidityCall({
    coreProgram: program,
    coreFunction: 'increase_liquidity',
    routerPrefix: 'increase_from',
    route0,
    route1,
    record0: params.token0Record,
    record1: params.token1Record,
    senderProof0,
    senderProof1,
  })
  const inputs: TransactionInput[] = [
    params.positionRecord,
    ...dispatch.recordInputs,
    ...tail(params.tickLowerHint, params.tickUpperHint),
  ]
  const transactionId = await writeContract(client, {
    program: dispatch.program,
    function: dispatch.functionName,
    imports: params.imports ? Object.keys(params.imports) : undefined,
    inputs,
  })
  // The id is stable across position operations. Prefer the id inside a
  // granted plaintext (the position actually spent); fall back to the
  // caller-supplied id for opaque record requests.
  const positionTokenId =
    (typeof params.positionRecord === 'string'
      ? positionTokenIdFromPlaintext(params.positionRecord)
      : undefined) ?? params.positionTokenId
  return { positionTokenId, transactionId }
}
