import { getFreezeList, type Client } from '@provablehq/veil-core'

import {
  buildExclusionProof,
  prepareFreezeList,
  type BuildExclusionProofReturnType,
  type PreparedFreezeList,
} from '../actions/buildExclusionProof.js'

/**
 * Parameters for {@link FreezelistActions.getFreezeListTree}.
 *
 * @property program Freezelist-owning program to read, such as
 *   `shield_swap_freezelist.aleo`. Named per call because compliance-gated
 *   operations span several lists — a position mint against a wrapped pair
 *   proves against the AMM's freezelist and each wrapper's — so no single list
 *   is the client's.
 */
export type GetFreezeListTreeParameters = {
  program: string
}

/**
 * Parameters for {@link FreezelistActions.getExclusionProof}.
 *
 * @property program Freezelist-owning program to prove against.
 * @property address The address whose absence from that list is proved.
 */
export type GetExclusionProofParameters = {
  program: string
  address: string
}

/** The actions {@link freezelistActions} adds to a client. */
export type FreezelistActions = {
  getFreezeListTree: (params: GetFreezeListTreeParameters) => Promise<PreparedFreezeList>
  getExclusionProof: (params: GetExclusionProofParameters) => Promise<BuildExclusionProofReturnType>
}

/**
 * Extends a client with compliance freezelist reads and proof construction.
 *
 * Pairs `getFreezeList` — which returns a list as a flat Merkle tree — with
 * local proof construction, so a program id and an address are enough to reach
 * the `[MerkleProof; 2]` pair a compliance-gated transition takes.
 *
 * Every action names its program. Each compliance-gated program keeps its own
 * list, and a single operation routinely spans more than one: minting a
 * position against a wrapped pair proves the parties against the AMM's
 * freezelist and the sender against each wrapper's.
 *
 * The actions hold no cache. A freezelist reshapes whenever its address count
 * crosses a power of two, which changes both the root and the depth and voids
 * every outstanding proof, so a cache has to be keyed on the root and
 * revalidated rather than held for a client's lifetime. Callers cutting several
 * proofs against one list — a mint proves a signer, a recipient and a
 * withdrawal address — should call
 * {@link FreezelistActions.getFreezeListTree} once and pass the result to
 * {@link buildExclusionProof}, which skips a decode worth several milliseconds
 * on a large list.
 *
 * @param client Client whose transport serves the reads.
 * @returns The freezelist actions, bound to that client.
 *
 * @example
 * const client = publicClient.extend(freezelistActions)
 *
 * const proofs = await client.getExclusionProof({
 *   program: 'shield_swap_freezelist.aleo',
 *   address: account.address,
 * })
 *
 * @example
 * // Several parties against one list: read and decode once.
 * const list = await client.getFreezeListTree({ program: 'shield_swap_freezelist.aleo' })
 * const [signerProofs, recipientProofs] = [signer, recipient].map((address) =>
 *   buildExclusionProof({ tree: list, address }),
 * )
 */
export function freezelistActions(client: Client): FreezelistActions {
  return {
    getFreezeListTree: async (params) =>
      prepareFreezeList(await getFreezeList(client, { programId: params.program })),

    getExclusionProof: async (params) => {
      const tree = await getFreezeList(client, { programId: params.program })
      return buildExclusionProof({ tree, address: params.address })
    },
  }
}
