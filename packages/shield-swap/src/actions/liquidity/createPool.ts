import { executeContract, writeContract, type Client } from '@veil/core'
import { isFeeTierValid, getFeeToTickSpacing } from '../reads/validation.js'
import { MIN_TICK, MAX_TICK, getSqrtPriceAtTick } from '../../utils/tick-math.js'
import { DEFAULT_PROGRAM } from '../../constants.js'

/**
 * Parameters for {@link createPool}.
 *
 * @property token0ProgramId Token id (field literal) of the pair's first
 *   token. The contract sorts the pair internally, so order does not matter.
 * @property token1ProgramId Token id (field literal) of the pair's second token.
 * @property fee Fee tier in pips (u16, e.g. `3000` = 0.30%). Must be
 *   registered with the program — validated pre-flight.
 * @property initialTick Tick whose price the pool opens at. The initial
 *   sqrt price is derived from it via the contract's own table.
 * @property initialSqrtPrice Explicit Q64 initial sqrt price. Defaults to
 *   `getSqrtPriceAtTick(initialTick)` — override only when reproducing an
 *   exact historical price.
 * @property tickSpacing Explicit tick spacing. Defaults to the canonical
 *   spacing bound to `fee` on chain (`fee_to_tick_spacing`) — overriding is
 *   almost never right.
 * @property imports Program sources for dynamic-dispatch dependencies
 *   (`{ 'token.aleo': source }`). The prover cannot discover `IARC20@(...)`
 *   callees statically — pass the involved token programs' sources when
 *   proving locally or via a service that requires them.
 * @property program shield_swap program override. Defaults to `DEFAULT_PROGRAM`
 *   (the live shield_swap deployment).
 */
export type CreatePoolParameters = {
  token0ProgramId: string
  token1ProgramId: string
  fee: number
  initialTick: number
  initialSqrtPrice?: bigint
  tickSpacing?: number
  imports?: Record<string, string>
  program?: string
}

/**
 * The created pool's essentials.
 *
 * @property poolKey The pool key field literal (the transition's first
 *   public output) — the key every read and swap uses. Known immediately on
 *   the local path; `undefined` on the wallet path until the transaction
 *   confirms.
 * @property transactionId The create transaction's id.
 */
export type CreatePoolReturnType = {
  poolKey?: string
  transactionId: string
}

/**
 * Creates a pool for a token pair at a fee tier.
 *
 * Validates the fee tier and resolves its canonical tick spacing on chain
 * before submitting — an unregistered fee or wrong spacing is a
 * guaranteed-revert transaction. All `create_pool` inputs are public, so
 * both signer paths submit the same literals.
 *
 * Hits the network: two validation reads plus the transaction. Signs, and
 * on the local path proves locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The pair, fee, and opening price.
 * @returns The pool key (local path) and transaction id.
 * @throws When the fee tier is unregistered or has no bound tick spacing;
 *   when `initialTick` is out of range; and on transport/proving errors.
 *
 * @example
 * const { poolKey } = await createPool(client, {
 *   token0ProgramId, token1ProgramId, fee: 3000, initialTick: 0,
 * })
 */
export async function createPool(client: Client, params: CreatePoolParameters): Promise<CreatePoolReturnType> {
  const program = params.program ?? DEFAULT_PROGRAM

  if (params.initialTick < MIN_TICK || params.initialTick >= MAX_TICK) {
    throw new Error(`initialTick ${params.initialTick} outside [${MIN_TICK}, ${MAX_TICK})`)
  }
  if (!(await isFeeTierValid(client, { fee: params.fee, program }))) {
    throw new Error(`Fee tier ${params.fee} is not registered with ${program}`)
  }
  const boundSpacing = await getFeeToTickSpacing(client, { fee: params.fee, program })
  const tickSpacing = params.tickSpacing ?? boundSpacing ?? undefined
  if (tickSpacing === undefined) {
    throw new Error(`Fee ${params.fee} has no tick spacing bound on chain — pass tickSpacing explicitly`)
  }

  const initialSqrtPrice = params.initialSqrtPrice ?? getSqrtPriceAtTick(params.initialTick)

  // All-public inputs — identical literals on both signer paths.
  const inputs = [
    params.token0ProgramId,
    params.token1ProgramId,
    `${params.fee}u16`,
    `${initialSqrtPrice}u128`,
    `${tickSpacing}u32`,
    `${params.initialTick}i32`,
  ]

  const account = (client as { account?: { type: string } }).account
  if (account?.type === 'local') {
    const result = await executeContract(client, { program, function: 'create_pool',
      imports: params.imports, inputs })
    const poolKey = result.outputs[0]
    if (!poolKey?.endsWith('field')) {
      throw new Error(`Unexpected create_pool output shape: ${JSON.stringify(result.outputs)}`)
    }
    return { poolKey, transactionId: result.transactionId }
  }

  const transactionId = await writeContract(client, { program, function: 'create_pool',
      imports: params.imports ? Object.keys(params.imports) : undefined, inputs })
  return { poolKey: undefined, transactionId }
}
