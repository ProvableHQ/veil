import { freezelistProofRequest, isFreezelistProofRequest, type FreezelistProofInput } from '@provablehq/veil-core'
import { SHIELD_SWAP_FREEZELIST } from '../constants.js'

// Freezelist Merkle-proof assembly.
//
// The stack runs separate freezelists: the AMM's own (proved on mint, claim,
// and collect) and each ARC-22 stablecoin's (proved on wrapper deposits and
// withdrawals). The legacy all-zero witness remains available for deployed
// contracts that accept it; populated lists require witnesses from a provider.
// The credits wrapper takes the proof parameter for compatibility and ignores it.

/**
 * One Merkle non-inclusion proof as the contracts take it.
 *
 * @property siblings The 16-deep sibling path as `field` literals.
 * @property leaf_index Leaf position (u32) the path is anchored at.
 */
export interface MerkleProofInput {
  siblings: string[]
  leaf_index: number
}

/** Preserves the legacy all-zero witness; acceptance depends on the deployed root and verifier. */
export const EMPTY_MERKLE_PROOF: MerkleProofInput = Object.freeze({
  siblings: Object.freeze(Array(16).fill('0field')) as unknown as string[],
  leaf_index: 1,
})

/**
 * The proof-pair every non-inclusion argument takes (`[MerkleProof; 2]`),
 * filled with the legacy all-zero witness. It is also a no-compliance
 * placeholder for wrappers that ignore proofs; it is not a general proof
 * for arbitrary empty or populated Merkle trees.
 */
export const EMPTY_MERKLE_PROOFS: readonly [MerkleProofInput, MerkleProofInput] = Object.freeze([
  EMPTY_MERKLE_PROOF,
  EMPTY_MERKLE_PROOF,
])

/**
 * Identifies which freezelist a proof pair is for and who it proves.
 *
 * @property list `'amm'` for shield_swap's freezelist; `'wrapper'` for an
 *   ARC-22 stablecoin's.
 * @property program The AMM freezelist program for `amm`; the wrapper
 *   program for `wrapper` (providers resolve its actual compliance list).
 * @property subject The address whose non-inclusion is proved.
 * @property subjectIsSigner Identifies a signer slot; wallet providers omit the
 *   address argument so the wallet selects its connected signer. Defaults to false.
 * @property underlyingProgram Identifies a wrapped token's underlying program
 *   for automatic compliance-list lookup. Omitted for AMM slots.
 */
export interface ProofContext {
  list: 'amm' | 'wrapper'
  program: string
  subject: string
  subjectIsSigner?: boolean
  underlyingProgram?: string
}

/**
 * Associates an externally computed proof with its list and subject.
 * @property freezelistProgram Names the compliance list, not the wrapper.
 * @property address Identifies the address proved by this witness.
 * @property proof Contains the encoded `[MerkleProof; 2]` Aleo literal.
 */
export type ProvidedProof = { freezelistProgram: string; address: string; proof: string }

/**
 * Accepts compliance Merkle proof literals in ABI order, annotated proofs, or a provider; null selects automatic generation.
 * @example
 * const proofs: ComplianceProofs<readonly [string]> = null
 */
export type ComplianceProofs<T extends readonly string[]> = T | (readonly [string] extends T ? string : never) | readonly ProvidedProof[] | ProofInputProvider | null

/** Bounds a swap's literals to its optional wrapped-input sender proof. */
export type SwapProofs = ComplianceProofs<readonly [] | readonly [sender: string]>
/** Bounds claim literals to AMM signer, wrapped output receiver, then wrapped refund receiver. */
export type ClaimProofs = ComplianceProofs<readonly [amm: string] | readonly [amm: string, receiver: string] | readonly [amm: string, output: string, refund: string]>
/** Bounds mint literals to wrapped senders (side 0 then 1), then AMM signer, recipient and withdrawal. */
export type MintProofs = ComplianceProofs<readonly [string, string, string] | readonly [string, string, string, string] | readonly [string, string, string, string, string]>
/** Bounds increase literals to wrapped senders, side 0 before side 1. */
export type IncreaseProofs = ComplianceProofs<readonly [] | readonly [sender: string] | readonly [sender0: string, sender1: string]>
/** Bounds collect literals to AMM owner and withdrawal, then wrapped receivers, side 0 before side 1. */
export type CollectProofs = ComplianceProofs<readonly [string, string] | readonly [string, string, string] | readonly [string, string, string, string]>
/** Bounds rebalance literals to funded wrapped senders, wrapped receivers, then AMM owner and withdrawal. */
export type RebalanceProofs = ComplianceProofs<readonly [string, string] | readonly [string, string, string] | readonly [string, string, string, string] | readonly [string, string, string, string, string] | readonly [string, string, string, string, string, string]>

/**
 * Configures automatic proof resolution for another deployment.
 * @property ammFreezelistProgram Overrides `shield_swap_freezelist.aleo`.
 * @property wrapperFreezelists Supplies the complete mapping for custom wrappers;
 *   null marks a wrapper that ignores proofs. When omitted, lookup recognizes
 *   credits and the mainnet/testnet USDCx underlying programs.
 */
export type FreezelistConfig = {
  ammFreezelistProgram?: string
  wrapperFreezelists?: Readonly<Record<string, string | null>>
}

/**
 * Supplies real non-inclusion witnesses once a freezelist is populated.
 * Returns the `[MerkleProof; 2]` pair for the subject against the current
 * (or grace-window previous) root.
 */
export type ProofProvider = (context: ProofContext) => Promise<readonly [MerkleProofInput, MerkleProofInput]>

/**
 * Resolves the proof pair for a context: the provider's witness when one is
 * configured, the legacy all-zero witness otherwise. Its acceptance depends
 * on the deployed verifier and accepted root.
 *
 * @param provider The configured provider, or undefined to retain the legacy
 *   all-zero witness.
 * @param context Which list and subject the proof is for.
 */
export async function resolveProofPair(
  provider: ProofProvider | undefined,
  context: ProofContext,
): Promise<readonly [MerkleProofInput, MerkleProofInput]> {
  if (!provider) return EMPTY_MERKLE_PROOFS
  return provider(context)
}

/**
 * Formats a proof pair as the `[MerkleProof; 2]` Aleo literal the
 * transitions take.
 *
 * @example
 * formatMerkleProofPair(EMPTY_MERKLE_PROOFS)
 * // '[{ siblings: [0field, …], leaf_index: 1u32 }, { … }]'
 */
export function formatMerkleProofPair(proofs: readonly [MerkleProofInput, MerkleProofInput]): string {
  const one = (p: MerkleProofInput): string => {
    if (p.siblings.length !== 16) {
      throw new Error(`MerkleProof needs 16 siblings, got ${p.siblings.length}`)
    }
    return `{ siblings: [${p.siblings.join(', ')}], leaf_index: ${p.leaf_index}u32 }`
  }
  return `[${one(proofs[0])}, ${one(proofs[1])}]`
}

/**
 * Supplies a proof pair, encoded proof literal, or wallet-derived request.
 *
 * Extends the existing pair provider without changing its return contract.
 * Wallet requests require a wallet account with the algorithm granted at connect.
 *
 * @example
 * const proofs: ProofInputProvider = walletFreezelistProofProvider({ wrapperFreezelists: {} })
 */
export type ProofInputProvider = (context: ProofContext) => Promise<
  readonly [MerkleProofInput, MerkleProofInput] | FreezelistProofInput
>

/**
 * Configures the deployment lists used by wallet-derived proofs.
 *
 * @property wrapperFreezelists Maps each wrapper program to the actual freezelist
 *   program. An explicit `null` identifies a wrapper that ignores the proof,
 *   such as credits. Missing wrappers cause an error; names are never inferred.
 * @property ammFreezelistProgram Overrides the AMM list; defaults to
 *   `shield_swap_freezelist.aleo`.
 *
 * @example
 * const config: WalletFreezelistProofParameters = {
 *   wrapperFreezelists: { 'usdcx_wrapper.aleo': 'usdcx_freezelist.aleo' },
 * }
 */
export interface WalletFreezelistProofParameters {
  wrapperFreezelists: Readonly<Record<string, string | null>>
  ammFreezelistProgram?: string
}

/**
 * Builds a provider that asks the wallet for each subject's non-inclusion proof.
 *
 * Uses explicit deployment metadata and leaves proof construction to the wallet.
 * Does not read the network, sign, or prove. The wallet must support the algorithm
 * and receive the matching {@link shieldSwapFreezelistGrants} at connect time.
 *
 * @param params Maps wrapper programs to their compliance lists; the AMM list
 *   defaults to `shield_swap_freezelist.aleo`.
 * @returns A provider accepted by every proof-bearing Shield Swap action.
 * @throws When resolving a wrapper with no configured compliance mapping.
 *
 * @example
 * const proofs = walletFreezelistProofProvider({
 *   wrapperFreezelists: { 'usdcx_wrapper.aleo': 'usdcx_freezelist.aleo' },
 * })
 */
export function walletFreezelistProofProvider(params: WalletFreezelistProofParameters): ProofInputProvider {
  // Snapshot configuration so later caller mutations cannot switch the list.
  const wrappers = { ...params.wrapperFreezelists }
  const amm = params.ammFreezelistProgram ?? SHIELD_SWAP_FREEZELIST
  return async (context) => {
    if (context.list === 'amm') {
      return freezelistProofRequest({ freezelistProgram: amm, ...(context.subjectIsSigner ? {} : { address: context.subject }) })
    }
    if (!Object.prototype.hasOwnProperty.call(wrappers, context.program)) {
      throw new Error(`No freezelist configured for wrapper ${context.program}; supply wrapperFreezelists explicitly`)
    }
    const freezelistProgram = wrappers[context.program]
    if (freezelistProgram === null) return EMPTY_MERKLE_PROOFS
    if (!freezelistProgram) throw new Error(`Invalid freezelist configured for wrapper ${context.program}`)
    return freezelistProofRequest({ freezelistProgram, ...(context.subjectIsSigner ? {} : { address: context.subject }) })
  }
}

/**
 * Resolves an action's proof slot without stringifying wallet requests.
 *
 * Preserves legacy providers and their all-zero default; a populated compliance
 * list requires a provider for its current accepted root.
 *
 * @param provider Supplies concrete proofs or wallet requests; omission retains
 *   the legacy placeholder.
 * @param context Identifies the list and exact address the contract checks.
 * @returns The encoded pair or wallet-derived input for the transaction.
 * @throws When the provider rejects the subject or a concrete pair is malformed.
 *
 * @example
 * const input = await resolveProofInput(undefined, {
 *   list: 'amm', program: 'shield_swap_freezelist.aleo', subject: 'aleo1...',
 * })
 */
export async function resolveProofInput(
  provider: ProofInputProvider | undefined,
  context: ProofContext,
): Promise<FreezelistProofInput> {
  const value = provider ? await provider(context) : EMPTY_MERKLE_PROOFS
  if (typeof value === 'string' || isFreezelistProofRequest(value)) return value
  return formatMerkleProofPair(value as readonly [MerkleProofInput, MerkleProofInput])
}

/**
 * Guards a proof provider against wallet requests on local signing paths.
 *
 * Rejects wallet requests when a proof is assembled, before transaction
 * execution or proving. Literal providers retain their behavior.
 *
 * @param provider The action's optional provider; omission stays undefined.
 * @param accountType The account's signer type; only `local` rejects requests.
 * @returns A guarded provider, or the original provider for wallet accounts.
 * @throws When a local account's provider returns a wallet-derived proof.
 *
 * @example
 * const guarded = proofProviderForAccount(async () => EMPTY_MERKLE_PROOFS, 'local')
 */
export function proofProviderForAccount(
  provider: ProofInputProvider | undefined,
  accountType: string,
): ProofInputProvider | undefined {
  if (!provider || accountType !== 'local') return provider
  return async (context) => {
    const value = await provider(context)
    if (isFreezelistProofRequest(value)) {
      throw new Error('Local accounts cannot resolve wallet-derived freezelist proofs; supply literal proofs or use a wallet account')
    }
    return value
  }
}
