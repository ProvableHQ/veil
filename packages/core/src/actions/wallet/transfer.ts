import type { Client } from '../../clients/createClient.js'
import { writeContract } from './writeContract.js'

export type TransferVisibility = 'public' | 'private' | 'shield' | 'unshield'

export type TransferParameters = {
  to: string
  amount: bigint
  /** Transfer visibility mode. Defaults to 'public'. */
  visibility?: TransferVisibility
  /** Program to transfer from. Defaults to 'credits.aleo'. */
  asset?: string
}

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

export async function transfer(
  client: Client,
  params: TransferParameters,
): Promise<TransferReturnType> {
  const visibility = params.visibility ?? 'public'
  const asset = params.asset ?? 'credits.aleo'
  const functionName = getFunctionName(visibility)

  return writeContract(client, {
    program: asset,
    function: functionName,
    inputs: [params.to, `${params.amount}u64`],
    privateFee: visibility === 'private' || visibility === 'unshield',
  })
}
