import { executeContract, writeContract, type Client, type InputRequest, type TransactionInput } from '@provablehq/veil-core'
import { selectTokenRecord, resolvePositionRecord, positionTokenIdFromPlaintext } from '../../utils/records.js'
import { requireAccount, requirePool } from '../../utils/guards.js'
import { pickInsertHint } from '../../utils/tick-hints.js'
import { DEFAULT_PROGRAM } from '../../constants.js'

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
 * @property token0Program Program holding token0 records (local path
 *   auto-select).
 * @property token1Program Program holding token1 records.
 * @property token0Record Explicit token0 record input.
 * @property token1Record Explicit token1 record input.
 * @property tickLowerHint Explicit hint override; defaults to
 *   `pickInsertHint` for the position's own bounds.
 * @property tickUpperHint Explicit hint override.
 * @property imports Program sources for dynamic-dispatch dependencies
 *   (`{ 'token.aleo': source }`). The prover cannot discover `IARC20@(...)`
 *   callees statically — pass the involved token programs' sources when
 *   proving locally or via a service that requires them.
 * @property program shield_swap program override.
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
  tickLowerHint?: number
  tickUpperHint?: number
  imports?: Record<string, string>
  program?: string
}

/**
 * The increase's essentials.
 *
 * @property positionTokenId The grown position's `token_id` (first public
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
 * — this only deepens it.
 *
 * Signer paths mirror `mint`: local accounts auto-select the
 * position and token records; wallet accounts must supply all three record
 * inputs explicitly.
 *
 * Hits the network: pool read, record scans, hint reads, and the
 * transaction. Signs, and on the local path proves locally.
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
 *   token0Program: 'ethx_5a095e.aleo', token1Program: 'usdc_5a095e.aleo',
 * })
 */
export async function increaseLiquidity(
  client: Client,
  params: IncreaseLiquidityParameters,
): Promise<IncreaseLiquidityReturnType> {
  const program = params.program ?? DEFAULT_PROGRAM

  const pool = await requirePool(client, params.poolKey, program)

  const isLocal = requireAccount(client, 'increaseLiquidity').type === 'local'

  if (isLocal) {
    // Token records must be literals on the local path; resolvePositionRecord
    // applies the same rule to the position record below.
    if (typeof params.token0Record === 'object' || typeof params.token1Record === 'object') {
      throw new Error('Local accounts cannot use InputRequests — pass record plaintext literals instead')
    }

    // Resolve the position for its record AND its tick bounds (→ hints).
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

    const record0 = params.token0Record ?? (await autoSelect(client, params.token0Program, pool.token0, params.amount0Desired, 'token0'))
    const record1 = params.token1Record ?? (await autoSelect(client, params.token1Program, pool.token1, params.amount1Desired, 'token1'))

    const result = await executeContract(client, {
      program,
      function: 'increase_liquidity',
      imports: params.imports,
      inputs: [
        positionPlaintext,
        record0,
        record1,
        `${params.amount0Desired}u128`,
        `${params.amount1Desired}u128`,
        `${params.amount0Min ?? 0n}u128`,
        `${params.amount1Min ?? 0n}u128`,
        pool.token0,
        pool.token1,
        `${tickLowerHint}i32`,
        `${tickUpperHint}i32`,
      ],
    })
    const positionTokenId = result.outputs[0]
    if (!positionTokenId?.endsWith('field')) {
      throw new Error(`Unexpected increase_liquidity output shape: ${JSON.stringify(result.outputs)}`)
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
  const inputs: TransactionInput[] = [
    params.positionRecord,
    params.token0Record,
    params.token1Record,
    `${params.amount0Desired}u128`,
    `${params.amount1Desired}u128`,
    `${params.amount0Min ?? 0n}u128`,
    `${params.amount1Min ?? 0n}u128`,
    pool.token0,
    pool.token1,
    `${params.tickLowerHint}i32`,
    `${params.tickUpperHint}i32`,
  ]
  const transactionId = await writeContract(client, { program, function: 'increase_liquidity',
      imports: params.imports ? Object.keys(params.imports) : undefined, inputs })
  // The id is stable across position operations. Prefer the id inside a
  // granted plaintext (the position actually spent); fall back to the
  // caller-supplied id for opaque record requests.
  const positionTokenId =
    (typeof params.positionRecord === 'string'
      ? positionTokenIdFromPlaintext(params.positionRecord)
      : undefined) ?? params.positionTokenId
  return { positionTokenId, transactionId }
}

/** Auto-select a token record on the local path, with an actionable error. */
async function autoSelect(
  client: Client,
  tokenProgram: string | undefined,
  tokenId: string,
  minAmount: bigint,
  label: string,
): Promise<string> {
  if (!tokenProgram) {
    throw new Error(`${label}Program is required to auto-select a record (or pass ${label}Record explicitly)`)
  }
  const picked = await selectTokenRecord(client, { program: tokenProgram, minAmount, tokenId })
  return picked.record.recordPlaintext
}
