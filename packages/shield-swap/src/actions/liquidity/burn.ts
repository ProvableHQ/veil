import { executeContract, writeContract, type Client, type InputRequest, type TransactionInput } from '@provablehq/veil-core'
import { resolvePositionRecord } from '../../utils/records.js'
import { requireAccount } from '../../utils/guards.js'
import { DEFAULT_PROGRAM } from '../../constants.js'

/**
 * Parameters for {@link burn}.
 *
 * @property poolKey Pool the position belongs to. Used to locate the
 *   PositionNFT on the local path.
 * @property positionTokenId Which position to burn, by `token_id`. Optional on
 *   the local path (first unspent position for the pool is used); ignored when
 *   `positionRecord` is given.
 * @property positionRecord Explicit PositionNFT record input (plaintext
 *   literal, or a `record` InputRequest for wallet signers — REQUIRED for
 *   wallets).
 * @property program shield_swap program override. Defaults to `DEFAULT_PROGRAM`.
 */
export type BurnParameters = {
  poolKey: string
  positionTokenId?: string
  positionRecord?: string | InputRequest
  program?: string
}

/**
 * The burn's essentials.
 *
 * @property positionTokenId The burned position's `token_id` (first public
 *   output on the local path; `undefined` on the wallet path until
 *   confirmation).
 * @property transactionId The transaction's id.
 */
export type BurnReturnType = {
  positionTokenId?: string
  transactionId: string
}

/**
 * Closes a fully-drained position by consuming its PositionNFT.
 *
 * The contract requires the position hold zero liquidity and zero
 * `tokens_owed` before it can be burned, so call {@link decreaseLiquidity} to
 * zero the liquidity and {@link collect} to sweep any owed tokens first. The
 * PositionNFT record is consumed and not re-issued.
 *
 * Signer paths mirror {@link decreaseLiquidity}: a local account auto-selects
 * the position record; a wallet account must supply `positionRecord`.
 *
 * Hits the network: a record scan (local) and the transaction. Signs, and on
 * the local path proves locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The position to burn and optional overrides.
 * @returns The burned position's token id (local path) and transaction id.
 * @throws When no matching position is found (local); when `positionRecord` is
 *   missing (wallet); when the position is not fully drained (on chain); and on
 *   transport/proving errors.
 *
 * @example
 * await burn(client, { poolKey, positionTokenId })
 */
export async function burn(client: Client, params: BurnParameters): Promise<BurnReturnType> {
  const program = params.program ?? DEFAULT_PROGRAM

  const isLocal = requireAccount(client, 'burn').type === 'local'

  if (isLocal) {
    const { plaintext: positionPlaintext } = await resolvePositionRecord(client, {
      positionRecord: params.positionRecord,
      program,
      poolKey: params.poolKey,
      tokenId: params.positionTokenId,
    })

    const result = await executeContract(client, {
      program,
      function: 'burn',
      inputs: [positionPlaintext],
    })
    const positionTokenId = result.outputs[0]
    if (!positionTokenId?.endsWith('field')) {
      throw new Error(`Unexpected burn output shape: ${JSON.stringify(result.outputs)}`)
    }
    return { positionTokenId, transactionId: result.transactionId }
  }

  if (params.positionRecord === undefined) {
    throw new Error('Wallet accounts must provide positionRecord (a record InputRequest or granted plaintext)')
  }
  const inputs: TransactionInput[] = [params.positionRecord]
  const transactionId = await writeContract(client, { program, function: 'burn', inputs })
  return { positionTokenId: undefined, transactionId }
}
