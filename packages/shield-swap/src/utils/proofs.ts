// Freezelist Merkle-proof assembly.
//
// The stack runs separate freezelists: the AMM's own (proved on mint, claim,
// and collect) and each ARC-22 stablecoin's (proved on wrapper deposits and
// withdrawals). While a list is empty the contracts accept the canonical
// empty-tree witness; once populated, real witnesses come from a
// caller-supplied provider. The credits wrapper takes the proof parameter
// for interface compatibility and ignores it.

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

/** The canonical witness accepted while a freezelist tree is empty. */
export const EMPTY_MERKLE_PROOF: MerkleProofInput = Object.freeze({
  siblings: Object.freeze(Array(16).fill('0field')) as unknown as string[],
  leaf_index: 1,
})

/**
 * The proof-pair every non-inclusion argument takes (`[MerkleProof; 2]`),
 * filled with the empty-tree witness.
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
 * @property program The freezelist-owning program the proof verifies
 *   against (e.g. `shield_swap_freezelist.aleo`, `test_usdcx_freezelist.aleo`).
 * @property subject The address whose non-inclusion is proved.
 */
export interface ProofContext {
  list: 'amm' | 'wrapper'
  program: string
  subject: string
}

/**
 * Supplies real non-inclusion witnesses once a freezelist is populated.
 * Returns the `[MerkleProof; 2]` pair for the subject against the current
 * (or grace-window previous) root.
 */
export type ProofProvider = (context: ProofContext) => Promise<readonly [MerkleProofInput, MerkleProofInput]>

/**
 * Resolves the proof pair for a context: the provider's witness when one is
 * configured, the empty-tree witness otherwise.
 *
 * @param provider The configured provider, or undefined while freezelists
 *   are empty.
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
