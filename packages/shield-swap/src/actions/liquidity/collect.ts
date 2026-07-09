import { executeContract, writeContract, type Client, type InputRequest, type TransactionInput } from '@provablehq/veil-core'
import { resolvePositionRecord } from '../../utils/records.js'
import { requireAccount, requirePool } from '../../utils/guards.js'
import { DEFAULT_PROGRAM } from '../../constants.js'

/**
 * Parameters for {@link collect}.
 *
 * @property poolKey Pool the position belongs to. Used to resolve the two
 *   token ids and to locate the PositionNFT on the local path.
 * @property amount0Requested Raw atomic token0 to withdraw from `tokens_owed`
 *   (u128). Capped on chain at the owed balance.
 * @property amount1Requested Raw atomic token1 to withdraw (u128).
 * @property recipient Address that receives the private token records.
 *   Defaults to the account address. MUST NOT be the program address.
 * @property positionTokenId Which position to collect from, by `token_id`.
 *   Optional on the local path (first unspent position for the pool is used);
 *   ignored when `positionRecord` is given.
 * @property positionRecord Explicit PositionNFT record input (plaintext
 *   literal, or a `record` InputRequest for wallet signers — REQUIRED for
 *   wallets).
 * @property imports Program sources for dynamic-dispatch dependencies
 *   (`{ 'token.aleo': source }`). The prover cannot discover `IARC20@(...)`
 *   callees statically — pass the involved token programs' sources when
 *   proving locally or via a service that requires them.
 * @property program shield_swap program override. Defaults to `DEFAULT_PROGRAM`.
 */
export type CollectParameters = {
  poolKey: string
  amount0Requested: bigint
  amount1Requested: bigint
  recipient?: string
  positionTokenId?: string
  positionRecord?: string | InputRequest
  imports?: Record<string, string>
  program?: string
}

/**
 * The collect's essentials.
 *
 * @property transactionId The transaction's id. The withdrawn tokens arrive as
 *   private records for `recipient`; the scanner picks them up.
 */
export type CollectReturnType = {
  transactionId: string
}

/**
 * Withdraws a position's owed tokens as private records.
 *
 * Turns the `tokens_owed` balance accrued by {@link decreaseLiquidity} and fee
 * accumulation into private token records for `recipient`, keeping the
 * recipient's identity off-chain. Consumes the PositionNFT and re-issues it.
 *
 * Signer paths mirror {@link increaseLiquidity}: a local account auto-selects
 * the position record and passes literals; a wallet account must supply
 * `positionRecord`. The recipient defaults to the account address on both.
 *
 * Hits the network: a pool read, a record scan (local), and the transaction.
 * Signs, and on the local path proves locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The requested amounts and optional overrides.
 * @returns The transaction id; withdrawn tokens land as records for `recipient`.
 * @throws When the pool does not exist; when no matching position is found
 *   (local); when `positionRecord` is missing (wallet); and on
 *   transport/proving errors.
 *
 * @example
 * await collect(client, {
 *   poolKey, amount0Requested: 10n ** 17n, amount1Requested: 200_000n,
 * })
 */
export async function collect(client: Client, params: CollectParameters): Promise<CollectReturnType> {
  const program = params.program ?? DEFAULT_PROGRAM

  const pool = await requirePool(client, params.poolKey, program)

  const account = requireAccount(client, 'collect')
  const isLocal = account.type === 'local'
  const recipient = params.recipient ?? account.address

  // Shared tail after the position record: requested amounts, token ids, recipient.
  const tail: string[] = [
    `${params.amount0Requested}u128`,
    `${params.amount1Requested}u128`,
    pool.token0,
    pool.token1,
    recipient,
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
      function: 'collect',
      imports: params.imports,
      inputs: [positionPlaintext, ...tail],
    })
    // collect's first output is the re-issued PositionNFT record, not a public
    // field — there is no positional id to read back.
    return { transactionId: result.transactionId }
  }

  if (params.positionRecord === undefined) {
    throw new Error('Wallet accounts must provide positionRecord (a record InputRequest or granted plaintext)')
  }
  const inputs: TransactionInput[] = [params.positionRecord, ...tail]
  const transactionId = await writeContract(client, {
    program,
    function: 'collect',
    imports: params.imports ? Object.keys(params.imports) : undefined,
    inputs,
  })
  return { transactionId }
}
