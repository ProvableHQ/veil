import { executeContract, writeContract, type Client, type InputRequest, type TransactionInput } from '@provablehq/veil-core'
import { resolvePositionRecord } from '../../utils/records.js'
import { requireAccount } from '../../utils/guards.js'
import { DEFAULT_PROGRAM } from '../../constants.js'

/**
 * Parameters for {@link decreaseLiquidity}.
 *
 * @property poolKey Pool the position belongs to. Used to locate the
 *   PositionNFT on the local path.
 * @property liquidityToRemove Raw liquidity units to withdraw from the
 *   position (u128). Must not exceed the position's current liquidity.
 * @property amount0Min Minimum token0 credited to `tokens_owed` (slippage
 *   guard, raw atomic u128). Defaults to 0.
 * @property amount1Min Minimum token1 credited to `tokens_owed`. Defaults to 0.
 * @property positionTokenId Which position to shrink, by `token_id`. Optional
 *   on the local path (first unspent position for the pool is used); ignored
 *   when `positionRecord` is given.
 * @property positionRecord Explicit PositionNFT record input (plaintext
 *   literal, or a `record` InputRequest for wallet signers — REQUIRED for
 *   wallets).
 * @property program shield_swap program override. Defaults to `DEFAULT_PROGRAM`.
 */
export type DecreaseLiquidityParameters = {
  poolKey: string
  liquidityToRemove: bigint
  amount0Min?: bigint
  amount1Min?: bigint
  positionTokenId?: string
  positionRecord?: string | InputRequest
  program?: string
}

/**
 * The decrease's essentials.
 *
 * @property positionTokenId The shrunk position's `token_id` (first public
 *   output on the local path; `undefined` on the wallet path until
 *   confirmation).
 * @property transactionId The transaction's id.
 */
export type DecreaseLiquidityReturnType = {
  positionTokenId?: string
  transactionId: string
}

/**
 * Removes liquidity from a position without moving any tokens.
 *
 * Consumes the PositionNFT record and re-issues it with reduced liquidity. The
 * withdrawn principal and any accrued fees settle into the position's
 * `tokens_owed`; a later {@link collect} turns that owed balance into token
 * records. No `IARC20` transfer happens here, so no `imports` are needed.
 *
 * Signer paths mirror {@link increaseLiquidity}: a local account auto-selects
 * the position record; a wallet account must supply `positionRecord`.
 *
 * Hits the network: a record scan (local) and the transaction. Signs, and on
 * the local path proves locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The amount to remove and optional overrides.
 * @returns The position token id (local path) and transaction id.
 * @throws When no matching position is found (local); when `positionRecord` is
 *   missing (wallet); and on transport/proving errors.
 *
 * @example
 * await decreaseLiquidity(client, { poolKey, liquidityToRemove: 500_000n })
 */
export async function decreaseLiquidity(
  client: Client,
  params: DecreaseLiquidityParameters,
): Promise<DecreaseLiquidityReturnType> {
  const program = params.program ?? DEFAULT_PROGRAM

  const isLocal = requireAccount(client, 'decreaseLiquidity').type === 'local'

  // Shared tail after the position record: the amount and the two slippage mins.
  const tail: string[] = [
    `${params.liquidityToRemove}u128`,
    `${params.amount0Min ?? 0n}u128`,
    `${params.amount1Min ?? 0n}u128`,
  ]

  if (isLocal) {
    const { plaintext: positionPlaintext } = await resolvePositionRecord(client, {
      positionRecord: params.positionRecord,
      program,
      poolKey: params.poolKey,
      tokenId: params.positionTokenId,
    })

    const result = await executeContract(client, {
      program,
      function: 'decrease_liquidity',
      inputs: [positionPlaintext, ...tail],
    })
    const positionTokenId = result.outputs[0]
    if (!positionTokenId?.endsWith('field')) {
      throw new Error(`Unexpected decrease_liquidity output shape: ${JSON.stringify(result.outputs)}`)
    }
    return { positionTokenId, transactionId: result.transactionId }
  }

  if (params.positionRecord === undefined) {
    throw new Error('Wallet accounts must provide positionRecord (a record InputRequest or granted plaintext)')
  }
  const inputs: TransactionInput[] = [params.positionRecord, ...tail]
  const transactionId = await writeContract(client, { program, function: 'decrease_liquidity', inputs })
  return { positionTokenId: undefined, transactionId }
}
