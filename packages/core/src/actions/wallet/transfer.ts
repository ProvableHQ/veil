import type { Client } from '../../clients/createClient.js'
import { writeContract } from './writeContract.js'

/**
 * Which side of the transfer is private: `public` (public → public), `private`
 * (private → private), `shield` (public → private), or `unshield`
 * (private → public).
 */
export type TransferVisibility = 'public' | 'private' | 'shield' | 'unshield'

/**
 * Parameters for `walletClient.transfer`.
 *
 * @property to Recipient address (`aleo1...`).
 * @property amount Amount in the asset's base units — microcredits for
 *   `credits.aleo` — as an atomic integer.
 * @property visibility Optional transfer visibility mode. Defaults to `'public'`.
 * @property asset Optional program to transfer from. Defaults to `'credits.aleo'`.
 * @property amountWidth Optional integer width the program's `transfer_*`
 *   functions take the amount as. Defaults to `'u64'` (credits.aleo); ARC-20
 *   style token programs (token_registry.aleo and the compliance stablecoins)
 *   take `'u128'`. The caller owns this knowledge — core does not keep a
 *   program list.
 * @property merkleProof Optional compliance proof appended as the final input
 *   on `private`/`unshield` transfers, for programs whose transfer functions
 *   require one (e.g. usdcx_stablecoin.aleo, usad_stablecoin.aleo take a
 *   `[MerkleProof; 2u32]`). Pass it pre-formatted as a single Aleo input
 *   string. Ignored for `public`/`shield` visibility, where those programs do
 *   not take a proof.
 */
export type TransferParameters = {
  to: string
  amount: bigint
  visibility?: TransferVisibility
  asset?: string
  amountWidth?: 'u64' | 'u128'
  merkleProof?: string
}

/** Transaction id (`at1...`) of the broadcast transfer. */
export type TransferReturnType = string

/**
 * Maps visibility mode to the corresponding function name.
 *
 * For credits.aleo:
 *   public   → transfer_public           (public to public)
 *   private  → transfer_private          (private to private)
 *   shield   → transfer_public_to_private (public → private)
 *   unshield → transfer_private_to_public (private → public)
 *
 * For custom token programs, the same naming convention is assumed.
 * If a program uses different names, use writeContract() directly.
 */
function getFunctionName(visibility: TransferVisibility): string {
  switch (visibility) {
    case 'public': return 'transfer_public'
    case 'private': return 'transfer_private'
    case 'shield': return 'transfer_public_to_private'
    case 'unshield': return 'transfer_private_to_public'
  }
}

/**
 * Transfers an asset to a recipient, selecting the transfer function from the
 * visibility mode.
 *
 * Thin wrapper over `writeContract` that maps `visibility` to the program's
 * `transfer_*` function (see `getFunctionName`), so it carries the same side
 * effects: signs, proves (in the wallet for RPC accounts, via the proving
 * config for local accounts), and broadcasts. Returns once the transaction is
 * submitted — it does not wait for acceptance; poll `transactionStatus` for
 * that. `private` and `unshield` transfers spend a private record, so the fee
 * is paid privately too.
 *
 * Assumes the credits.aleo `(recipient, amount)` transfer shape. Token
 * programs that share it but take wider amounts set `amountWidth: 'u128'`;
 * compliance programs that additionally require a merkle proof on the private
 * side pass `merkleProof`. For a program whose function names or input shapes
 * differ — e.g. token_registry.aleo's PUBLIC transfers, which take a leading
 * `token_id` field — call `writeContract` directly.
 *
 * @param client Wallet client with an account attached.
 * @param params Recipient, amount, and optional visibility/asset/width/proof.
 * @returns The transaction id to poll with `transactionStatus`.
 * @throws AccountNotFoundError if the client has no signing account.
 * @throws ProvingNotConfiguredError if the account is local and the client has no proving config.
 *
 * @example
 * const txId = await walletClient.transfer({
 *   to: 'aleo1...',
 *   amount: 1_000_000n, // 1 credit
 *   visibility: 'private',
 * })
 */
export async function transfer(
  client: Client,
  params: TransferParameters,
): Promise<TransferReturnType> {
  const visibility = params.visibility ?? 'public'
  const asset = params.asset ?? 'credits.aleo'
  const functionName = getFunctionName(visibility)
  const width = params.amountWidth ?? 'u64'

  // The proof rides only on the private side — public-side functions of the
  // compliance programs do not take one.
  const isPrivateSide = visibility === 'private' || visibility === 'unshield'
  const inputs = [params.to, `${params.amount}${width}`]
  if (isPrivateSide && params.merkleProof) inputs.push(params.merkleProof)

  return writeContract(client, {
    program: asset,
    function: functionName,
    inputs,
    privateFee: isPrivateSide,
  })
}
