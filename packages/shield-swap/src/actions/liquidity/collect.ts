import {
  executeContract,
  writeContract,
  type Client,
  type InputRequest,
  type TransactionInput,
} from '@provablehq/veil-core'
import { resolvePositionRecord } from '../../utils/records.js'
import { requireAccount, requirePool } from '../../utils/guards.js'
import type { TokenRoute } from '../../utils/routing.js'
import type { CollectProofs, FreezelistConfig } from '../../utils/proofs.js'
import { resolveComplianceProofs, ammProofContext, wrapperProofContext } from '../../utils/resolveProofs.js'
import { SHIELD_SWAP, SHIELD_SWAP_LP_ROUTER } from '../../constants.js'
import { resolveSideRoutes, resolveWithdrawalSubject } from './internal.js'

/**
 * Parameters for {@link collect}.
 *
 * @property poolKey Pool the position belongs to. Used to resolve the two
 *   token ids and to locate the PositionNFT on the local path.
 * @property amount0Requested Raw atomic token0 to withdraw from `tokens_owed`
 *   (u128). Capped on chain at the owed balance.
 * @property amount1Requested Raw atomic token1 to withdraw (u128).
 * @property positionTokenId Which position to collect from, by `token_id`.
 *   Optional on the local path (first unspent position for the pool is used);
 *   ignored when `positionRecord` is given.
 * @property positionRecord Explicit PositionNFT record input (plaintext
 *   literal, or a `record` InputRequest for wallet signers — REQUIRED for
 *   wallets).
 * @property token0Route Pre-resolved route override for token0 — skips the
 *   on-chain wrapped-ness read (offline/advanced use).
 * @property token1Route Pre-resolved route override for token1.
 * @property withdrawalAddress Explicit payout subject for proofs when the position
 *   record is opaque. Defaults to the plaintext record's withdrawal field.
 *   Required when that field is unavailable for automatic generation or a
 *   provider declaring requiresSubject. Supplied proofs and custom providers
 *   otherwise own subject selection. Must match plaintext when both are supplied.
 *   Does not change the contract's payout address.
 * @property proofs Supplies a {@link CollectProofs} literal tuple in ABI order, an annotated
 *   collection, or a provider. Omission or null enables automatic resolution.
 * @property freezelists Overrides deployment lists for automatic or annotated proofs;
 *   defaults to the known AMM, USDCx and credits lists.
 * @property imports Program sources for dynamic-dispatch dependencies
 *   (`{ 'token.aleo': source }`). The prover cannot discover `IARC20@(...)`
 *   callees statically — pass the involved token programs' sources when
 *   proving locally or via a service that requires them.
 * @property program shield_swap core program override. Defaults to
 *   `shield_swap.aleo`. Router calls always target
 *   `shield_swap_lp_router.aleo`.
 */
export type CollectParameters = {
  poolKey: string
  amount0Requested: bigint
  amount1Requested: bigint
  positionTokenId?: string
  positionRecord?: string | InputRequest
  token0Route?: TokenRoute
  token1Route?: TokenRoute
  withdrawalAddress?: string
  proofs?: CollectProofs
  freezelists?: FreezelistConfig
  imports?: Record<string, string>
  program?: string
}

/**
 * The collect's essentials.
 *
 * @property transactionId The transaction's id. The withdrawn tokens arrive
 *   as private records for the position's `withdrawal` address (a wrapped
 *   side pays out the UNDERLYING asset); the scanner picks them up.
 */
export type CollectReturnType = {
  transactionId: string
}

/**
 * Withdraws a position's owed tokens as private records.
 *
 * Turns the `tokens_owed` balance accrued by {@link decreaseLiquidity} and fee
 * accumulation into private token records, consuming the PositionNFT and
 * re-issuing it. The contract pays the position's `withdrawal` address fixed
 * at mint — there is no recipient input. Dispatches on the pair's
 * wrapped-ness like {@link mint}: both plain calls the core `collect`
 * directly; any wrapped side routes through `shield_swap_lp_router.aleo`
 * (`collect_to_wrapped_arc20` / `collect_to_arc20_wrapped` /
 * `collect_to_wrapped_wrapped`), which unwraps the wrapped side and pays out
 * the UNDERLYING asset's record.
 *
 * Signer paths mirror {@link increaseLiquidity}: a local account auto-selects
 * the position record and passes literals; a wallet account must supply
 * `positionRecord`.
 *
 * Hits the network: a pool read, route reads (cached per token), a record
 * scan (local), and the transaction. Signs, and on the local path proves
 * locally.
 *
 * @param client A Veil wallet client (local or wallet account).
 * @param params The requested amounts and optional overrides.
 * @returns The transaction id; withdrawn tokens land as records for the
 *   position's `withdrawal` address.
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
  const program = params.program ?? SHIELD_SWAP

  const pool = await requirePool(client, params.poolKey, program)

  const account = requireAccount(client, 'collect')
  const isLocal = account.type === 'local'

  const [route0, route1] = await resolveSideRoutes(client, {
    token0Id: pool.token0,
    token1Id: pool.token1,
    program,
    token0Route: params.token0Route,
    token1Route: params.token1Route,
  })

  // Resolve the position first: the withdrawal address inside the record is
  // the receiver every proof subject below refers to.
  let positionInput: TransactionInput
  if (isLocal) {
    const { plaintext } = await resolvePositionRecord(client, {
      positionRecord: params.positionRecord,
      program,
      poolKey: params.poolKey,
      tokenId: params.positionTokenId,
    })
    positionInput = plaintext
  } else {
    if (params.positionRecord === undefined) {
      throw new Error('Wallet accounts must provide positionRecord (a record InputRequest or granted plaintext)')
    }
    positionInput = params.positionRecord
  }

  const receiver = resolveWithdrawalSubject({
    positionInput, withdrawalAddress: params.withdrawalAddress,
    proofs: params.proofs, signerAddress: account.address,
  })

  // Core collect proves the owner and the withdrawal address against the
  // AMM freezelist; each wrapped side adds a wrapper receiver proof.
  const [ownerProofs, withdrawalProofs, receiverProof0, receiverProof1] = await resolveComplianceProofs(client, params.proofs, [
    ammProofContext(account.address, true),
    ammProofContext(receiver),
    wrapperProofContext(route0, receiver, false),
    wrapperProofContext(route1, receiver, false),
  ], params.freezelists)

  // Dispatch table: any wrapped side moves the call to the LP router, which
  // appends the wrapped sides' receiver proofs (side 0 before side 1).
  let target = program
  let functionName = 'collect'
  const receiverProofInputs: TransactionInput[] = []
  if (route0.wrapped || route1.wrapped) {
    target = SHIELD_SWAP_LP_ROUTER
    if (route0.wrapped && !route1.wrapped) {
      functionName = 'collect_to_wrapped_arc20'
      receiverProofInputs.push(receiverProof0!)
    } else if (!route0.wrapped && route1.wrapped) {
      functionName = 'collect_to_arc20_wrapped'
      receiverProofInputs.push(receiverProof1!)
    } else {
      functionName = 'collect_to_wrapped_wrapped'
      receiverProofInputs.push(receiverProof0!, receiverProof1!)
    }
  }

  const inputs: TransactionInput[] = [
    positionInput,
    `${params.amount0Requested}u128`,
    `${params.amount1Requested}u128`,
    pool.token0,
    pool.token1,
    ownerProofs,
    withdrawalProofs,
    ...receiverProofInputs,
  ]

  if (isLocal) {
    const result = await executeContract(client, {
      program: target,
      function: functionName,
      imports: params.imports,
      inputs,
    })
    // collect's first output is the re-issued PositionNFT record, not a public
    // field — there is no positional id to read back.
    return { transactionId: result.transactionId }
  }

  const transactionId = await writeContract(client, {
    program: target,
    function: functionName,
    imports: params.imports ? Object.keys(params.imports) : undefined,
    inputs,
  })
  return { transactionId }
}
