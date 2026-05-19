import type { Client } from '../../clients/createClient.js'
import { writeContract } from './writeContract.js'

export type TransferVisibility = 'public' | 'private' | 'shield' | 'unshield'

export type TransferParameters = {
  /** Aleo program id. Defaults to 'credits.aleo'. */
  asset?: string
  /** Visibility mode. Defaults to 'public'. */
  visibility?: TransferVisibility
  to: string
  amount: bigint
  /**
   * Merkle proof input for compliance-bearing programs (usdcx_stablecoin.aleo,
   * usad_stablecoin.aleo) on private/unshield transfers. Provided as a single
   * pre-formatted Aleo input string matching the program's `[MerkleProof; 2u32].private`
   * shape.
   */
  merkleProof?: string
  /**
   * Override the inferred amount width. Defaults: 'u64' for credits.aleo;
   * 'u128' for token_registry/usdcx/usad. Caller can override for custom programs.
   */
  amountWidth?: 'u64' | 'u128'
  /**
   * Override the inferred function name (e.g. 'transfer_public_as_signer').
   * When omitted, derived from `visibility`.
   */
  function?: string
  /**
   * Override the full inputs array. When set, all other input-derivation params
   * are ignored. Escape hatch for programs whose signatures don't match a known shape.
   */
  inputs?: string[]
  /** Override the inferred privateFee. */
  privateFee?: boolean
}

export type TransferReturnType = string

const KNOWN_U128_PROGRAMS: ReadonlySet<string> = new Set([
  'token_registry.aleo',
  'usdcx_stablecoin.aleo',
  'usad_stablecoin.aleo',
])

const KNOWN_MERKLE_PROOF_PROGRAMS: ReadonlySet<string> = new Set([
  'usdcx_stablecoin.aleo',
  'usad_stablecoin.aleo',
])

function getFunctionName(visibility: TransferVisibility): string {
  switch (visibility) {
    case 'public': return 'transfer_public'
    case 'private': return 'transfer_private'
    case 'shield': return 'transfer_public_to_private'
    case 'unshield': return 'transfer_private_to_public'
  }
}

function inferAmountWidth(asset: string, override?: 'u64' | 'u128'): 'u64' | 'u128' {
  if (override) return override
  return KNOWN_U128_PROGRAMS.has(asset) ? 'u128' : 'u64'
}

function buildInputs(
  asset: string,
  visibility: TransferVisibility,
  to: string,
  amount: bigint,
  width: 'u64' | 'u128',
  merkleProof?: string,
): string[] {
  const encodedAmount = `${amount}${width}`
  const base = [to, encodedAmount]

  if (
    (visibility === 'private' || visibility === 'unshield') &&
    KNOWN_MERKLE_PROOF_PROGRAMS.has(asset)
  ) {
    if (!merkleProof) {
      throw new Error(
        `transfer: ${asset} requires merkleProof for visibility=${visibility}`,
      )
    }
    return [...base, merkleProof]
  }

  return base
}

export async function transfer(
  client: Client,
  params: TransferParameters,
): Promise<TransferReturnType> {
  const asset = params.asset ?? 'credits.aleo'
  const visibility = params.visibility ?? 'public'
  const functionName = params.function ?? getFunctionName(visibility)
  const width = inferAmountWidth(asset, params.amountWidth)
  const inputs =
    params.inputs ?? buildInputs(asset, visibility, params.to, params.amount, width, params.merkleProof)
  const privateFee =
    params.privateFee ?? (visibility === 'private' || visibility === 'unshield')

  return writeContract(client, {
    program: asset,
    function: functionName,
    inputs,
    privateFee,
  })
}
