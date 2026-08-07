import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getFreezeList}.
 *
 * @property programId Freezelist-owning program to read, such as
 *   `shield_swap_freezelist.aleo`. Each compliance-gated program keeps its own
 *   list, so an AMM and every ARC-22 wrapper it settles through are separate
 *   reads.
 */
export type GetFreezeListParameters = { programId: string }

/**
 * A compliance freezelist, as a flat Merkle tree.
 *
 * Entries are field elements in decimal form, ordered bottom-up: the leaf row
 * first, then each successive row of internal nodes, with the Merkle root last.
 * A tree of `n` leaves has `2n - 1` entries.
 *
 * Leaves are the frozen addresses cast to fields, sorted ascending and
 * left-padded with `0` to reach a power of two, so the tree is the smallest
 * power-of-two shape that fits the list rather than a fixed-depth structure. An
 * empty list reads as `['0', '0', '<root>']` — two padding leaves and their
 * hash.
 */
export type GetFreezeListReturnType = string[]

/**
 * Fetches a program's compliance freezelist as a flat Merkle tree.
 *
 * Applies when constructing the Merkle non-inclusion proofs that
 * compliance-gated transitions take. The response carries every node a proof
 * needs, including the internal ones, so assembling a proof from it is pure
 * indexing and requires no hashing.
 *
 * The tree changes shape whenever the list changes — adding an address that
 * crosses a power of two doubles the leaf row — so its root, the last entry,
 * is the only durable identity it has and the natural key for caching it.
 * Hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Program whose freezelist to read.
 * @returns The tree, leaf row first and root last. See
 *   {@link GetFreezeListReturnType} for the layout.
 * @throws When the program tracks no freezelist, the node answers 404 and the
 *   transport raises. A program with no list is distinct from a program whose
 *   list is empty, and the latter returns a two-leaf tree.
 *
 * @example
 * const tree = await client.getFreezeList({
 *   programId: 'shield_swap_freezelist.aleo',
 * })
 * const root = tree[tree.length - 1]
 */
export async function getFreezeList(
  client: Client,
  params: GetFreezeListParameters,
): Promise<GetFreezeListReturnType> {
  return client.request({
    method: 'getFreezeList',
    params: { programId: params.programId },
  }) as Promise<GetFreezeListReturnType>
}
