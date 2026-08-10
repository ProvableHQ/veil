import { getFreezeList, type Client } from '@provablehq/veil-core'

import {
  buildExclusionProof,
  prepareFreezeList,
  type BuildExclusionProofReturnType,
  type PreparedFreezeList,
} from '../actions/buildExclusionProof.js'

/**
 * Options for {@link freezelistActions}.
 *
 * @property program Freezelist program the actions read when a call does not
 *   name one, such as `shield_swap_freezelist.aleo`. Defaults to none, in which
 *   case every call must pass a program.
 */
export type FreezelistActionsConfig = {
  program?: string
}

/** Parameters shared by the actions, naming the list to read. */
export type FreezeListParameters = {
  /** Freezelist program. Defaults to the decorator's configured program. */
  program?: string
}

/** Parameters for the client-bound exclusion proof action. */
export type GetExclusionProofParameters = FreezeListParameters & {
  /** The address whose absence from the list is proved. */
  address: string
}

/** The actions {@link freezelistActions} adds to a client. */
export type FreezelistActions = {
  getFreezeListTree: (params?: FreezeListParameters) => Promise<PreparedFreezeList>
  getExclusionProof: (params: GetExclusionProofParameters) => Promise<BuildExclusionProofReturnType>
}

/**
 * Extends a client with compliance freezelist reads and proof construction.
 *
 * Pairs `getFreezeList` — which returns the list as a flat Merkle tree — with
 * local proof construction, so a caller goes from a program id to the
 * `[MerkleProof; 2]` pair a compliance-gated transition takes in one call.
 *
 * The actions hold no cache. A freezelist reshapes whenever its address count
 * crosses a power of two, which changes both the root and the depth and voids
 * every outstanding proof, so a cache has to be keyed on the root and checked
 * rather than held for a client's lifetime. Callers cutting several proofs
 * against one list — a position mint proves a signer, a recipient and a
 * withdrawal address — should call {@link FreezelistActions.getFreezeListTree}
 * once and pass the result to {@link buildExclusionProof}, which skips a decode
 * worth several milliseconds on a large list.
 *
 * @param config Optional default program for the actions.
 * @returns A decorator for `client.extend`.
 *
 * @example
 * const client = publicClient.extend(
 *   freezelistActions({ program: 'shield_swap_freezelist.aleo' }),
 * )
 *
 * const proofs = await client.getExclusionProof({ address: account.address })
 *
 * @example
 * // Several proofs against one list: read and decode once.
 * const list = await client.getFreezeListTree()
 * const parties = [signer, recipient, withdrawal].map((address) =>
 *   buildExclusionProof({ tree: list, address }),
 * )
 */
export function freezelistActions(config: FreezelistActionsConfig = {}) {
  /** Resolves the program a call reads, preferring an explicit one. */
  const resolveProgram = (params?: FreezeListParameters): string => {
    const program = params?.program ?? config.program
    if (!program) {
      throw new Error(
        'No freezelist program — pass freezelistActions({ program }) or a program on the call.',
      )
    }
    return program
  }

  return (client: Client): FreezelistActions => ({
    getFreezeListTree: async (params) =>
      prepareFreezeList(await getFreezeList(client, { programId: resolveProgram(params) })),

    getExclusionProof: async (params) => {
      const tree = await getFreezeList(client, { programId: resolveProgram(params) })
      return buildExclusionProof({ tree, address: params.address })
    },
  })
}
