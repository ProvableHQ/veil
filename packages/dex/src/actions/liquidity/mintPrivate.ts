import { executeContract, writeContract, type Client, type InputRequest, type TransactionInput } from '@veil/core'
import { getPool } from '../reads/getPool.js'
import { selectTokenRecord } from '../../records.js'
import { generateFieldNonce } from '../../helpers/params.js'
import { roundTickToSpacing } from '../../helpers/tick-math.js'
import { pickInsertHint } from '../../helpers/tick-hints.js'
import { getSlot } from '../reads/getSlot.js'
import { DEFAULT_PROGRAM } from '../../constants.js'

/**
 * Formats a MintPositionRequest struct literal in the contract's exact
 * field order — pool, ticks, desired/min amounts, hints. Order is
 * load-bearing: struct hashing and the transition input both depend on it.
 */
export function formatMintPositionRequest(req: {
  pool: string
  tickLower: number
  tickUpper: number
  amount0Desired: bigint
  amount1Desired: bigint
  amount0Min: bigint
  amount1Min: bigint
  tickLowerHint: number
  tickUpperHint: number
}): string {
  return (
    `{ pool: ${req.pool}, tick_lower: ${req.tickLower}i32, tick_upper: ${req.tickUpper}i32, ` +
    `amount0_desired: ${req.amount0Desired}u128, amount1_desired: ${req.amount1Desired}u128, ` +
    `amount0_min: ${req.amount0Min}u128, amount1_min: ${req.amount1Min}u128, ` +
    `tick_lower_hint: ${req.tickLowerHint}i32, tick_upper_hint: ${req.tickUpperHint}i32 }`
  )
}

/**
 * Parameters for {@link mintPrivate}.
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
 * @property recipient Position owner. Defaults to the account address.
 *   MUST NOT be the program address.
 * @property token0Program Program holding the caller's token0 records —
 *   required on the local path unless `token0Record` is given.
 * @property token1Program Program holding the caller's token1 records.
 * @property token0Record Explicit record input (plaintext literal, or a
 *   `record` InputRequest for wallet signers — REQUIRED for wallets).
 * @property token1Record Explicit record input for token1.
 * @property tickLowerHint Explicit insert hint. Defaults to
 *   `pickInsertHint` (best-effort — see its limitation).
 * @property tickUpperHint Explicit insert hint for the upper bound.
 * @property nonce Explicit field nonce. Defaults to crypto-random.
 * @property imports Program sources for dynamic-dispatch dependencies
 *   (`{ 'token.aleo': source }`). The prover cannot discover `IARC20@(...)`
 *   callees statically — pass the involved token programs' sources when
 *   proving locally or via a service that requires them.
 * @property program shield_swap program override.
 */
export type MintPrivateParameters = {
  poolKey: string
  tickLower: number
  tickUpper: number
  amount0Desired: bigint
  amount1Desired: bigint
  amount0Min?: bigint
  amount1Min?: bigint
  recipient?: string
  token0Program?: string
  token1Program?: string
  token0Record?: string | InputRequest
  token1Record?: string | InputRequest
  tickLowerHint?: number
  tickUpperHint?: number
  nonce?: string
  imports?: Record<string, string>
  program?: string
}

/**
 * The minted position's essentials.
 *
 * @property positionTokenId The position's `token_id` (first public
 *   output) — the key for `getPosition` and later liquidity changes. Known
 *   immediately on the local path; `undefined` on the wallet path until
 *   confirmation.
 * @property transactionId The mint transaction's id.
 */
export type MintPrivateReturnType = {
  positionTokenId?: string
  transactionId: string
}

/**
 * Mints a new concentrated-liquidity position as a private PositionNFT.
 *
 * Deposits both tokens privately (records in, change back), aligns the tick
 * range to the pool's spacing, computes insert hints, and submits
 * `mint_private`. The PositionNFT record the transition returns is the key
 * to all later liquidity operations — the scanner will pick it up.
 *
 * Signer paths mirror `swapPrivate`: local accounts auto-select records and
 * pass literals; wallet accounts must supply both `tokenNRecord` inputs and
 * get the recipient defaulted to their address.
 *
 * Hits the network: pool/slot reads, hint reads, record scans, and the
 * transaction. Signs, and on the local path proves locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The range, amounts, and optional overrides.
 * @returns The position token id (local path) and transaction id.
 * @throws When the pool does not exist; when the range is empty after
 *   spacing alignment; when records are missing (local) or not provided
 *   (wallet); and on transport/proving errors.
 *
 * @example
 * const { positionTokenId } = await mintPrivate(client, {
 *   poolKey, tickLower: -62400, tickUpper: -60000,
 *   amount0Desired: 10n ** 18n, amount1Desired: 2_000_000n,
 *   token0Program: 'ethx_5a095e.aleo', token1Program: 'usdc_5a095e.aleo',
 * })
 */
export async function mintPrivate(client: Client, params: MintPrivateParameters): Promise<MintPrivateReturnType> {
  const program = params.program ?? DEFAULT_PROGRAM

  const pool = await getPool(client, { poolKey: params.poolKey, program })
  if (!pool) throw new Error(`Pool ${params.poolKey} does not exist on ${program}`)
  const slot = await getSlot(client, { poolKey: params.poolKey, program })
  if (!slot) throw new Error(`Pool ${params.poolKey} has no slot state on ${program}`)

  // Align the range to the pool's spacing; an empty range would revert.
  const tickLower = roundTickToSpacing(params.tickLower, slot.tick_spacing)
  const tickUpper = roundTickToSpacing(params.tickUpper, slot.tick_spacing)
  if (tickLower >= tickUpper) {
    throw new Error(`Empty tick range after spacing alignment: [${tickLower}, ${tickUpper})`)
  }

  const tickLowerHint =
    params.tickLowerHint ?? (await pickInsertHint(client, { poolKey: params.poolKey, targetTick: tickLower, program }))
  const tickUpperHint =
    params.tickUpperHint ?? (await pickInsertHint(client, { poolKey: params.poolKey, targetTick: tickUpper, program }))

  const request = formatMintPositionRequest({
    pool: params.poolKey,
    tickLower,
    tickUpper,
    amount0Desired: params.amount0Desired,
    amount1Desired: params.amount1Desired,
    amount0Min: params.amount0Min ?? 0n,
    amount1Min: params.amount1Min ?? 0n,
    tickLowerHint,
    tickUpperHint,
  })

  const account = (client as { account?: { type: string; address: string } }).account
  if (!account) throw new Error('mintPrivate requires a wallet client with an account')
  const isLocal = account.type === 'local'
  const nonce = params.nonce ?? generateFieldNonce()
  const recipient = params.recipient ?? account.address

  if (isLocal) {
    // Reject InputRequests BEFORE any selection work — an object here must
    // never silently fall through to auto-selection.
    if (typeof params.token0Record === 'object' || typeof params.token1Record === 'object') {
      throw new Error('Local accounts cannot use InputRequests — pass record plaintext literals instead')
    }
    const record0 =
      params.token0Record ?? (await autoSelect(client, params.token0Program, pool.token0, params.amount0Desired, 'token0'))
    const record1 =
      params.token1Record ?? (await autoSelect(client, params.token1Program, pool.token1, params.amount1Desired, 'token1'))

    const result = await executeContract(client, {
      program,
      function: 'mint_private',
      imports: params.imports,
      inputs: [nonce, record0, record1, recipient, request, pool.token0, pool.token1],
    })
    const positionTokenId = result.outputs[0]
    if (!positionTokenId?.endsWith('field')) {
      throw new Error(`Unexpected mint_private output shape: ${JSON.stringify(result.outputs)}`)
    }
    return { positionTokenId, transactionId: result.transactionId }
  }

  if (params.token0Record === undefined || params.token1Record === undefined) {
    throw new Error(
      'Wallet accounts must provide token0Record and token1Record (record InputRequests or granted plaintext)',
    )
  }
  const inputs: TransactionInput[] = [
    nonce,
    params.token0Record,
    params.token1Record,
    recipient,
    request,
    pool.token0,
    pool.token1,
  ]
  const transactionId = await writeContract(client, { program, function: 'mint_private',
      imports: params.imports ? Object.keys(params.imports) : undefined, inputs })
  return { positionTokenId: undefined, transactionId }
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
