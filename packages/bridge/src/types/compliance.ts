import type { FreezelistProofInput, FreezelistProofRequest } from '@provablehq/veil-core'

/**
 * Describes one Merkle path in a compliance exclusion bundle.
 * @property siblings Contains 16 Aleo field literals, starting at the leaf.
 * @property leaf_index Identifies the leaf with a u32 index.
 * @example const path: MerkleProofInput = { siblings: Array(16).fill('0field'), leaf_index: 1 }
 */
export type MerkleProofInput = { siblings: string[]; leaf_index: number }

/**
 * Identifies the compliance list and signer whose exclusion must be proved.
 * @property freezelistProgram Names the reviewed program owning the current root.
 * @property address Identifies the signer, not the unshield or bridge recipient.
 * @example const context: ComplianceProofContext = { freezelistProgram: 'usdcx_freezelist.aleo', address: 'aleo1...' }
 */
export type ComplianceProofContext = { freezelistProgram: string; address: string }

/**
 * Associates an externally computed bundle with its list and subject.
 * @property freezelistProgram Names the compliance list, not the token or wrapper.
 * @property address Identifies the signer proved by this witness.
 * @property proof Contains an encoded `[MerkleProof; 2]` Aleo literal.
 * @example const proof: SuppliedComplianceProof = { freezelistProgram: 'usdcx_freezelist.aleo', address: 'aleo1...', proof: '[...]' }
 */
export type SuppliedComplianceProof = ComplianceProofContext & { proof: string }

/**
 * Supplies one compliance bundle as a literal, Merkle pair, or wallet request.
 * The provider owns freshness; wallet requests require a compatible wallet and grant.
 * @param context Identifies the reviewed freezelist and connected signer.
 * @returns The bundle or signer-only wallet request for this operation.
 * @example const provider: ComplianceProofProvider = async () => '[...]'
 */
export type ComplianceProofProvider = (context: ComplianceProofContext) => Promise<
  FreezelistProofInput | readonly [MerkleProofInput, MerkleProofInput]
>

/**
 * Supplies the single compliance bundle required by an ARC-22 unshield or private xReserve burn.
 * Accepts a literal, one-element tuple, annotated proofs, provider, or wallet request.
 * Null or omission enables automatic generation for local accounts and derivation for wallets.
 * @example const proofs: ComplianceProofs = ['[...]']
 */
export type ComplianceProofs = string | readonly [string] | readonly SuppliedComplianceProof[] | ComplianceProofProvider | FreezelistProofRequest | null
