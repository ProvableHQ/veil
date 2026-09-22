import { SealanceMerkleTree } from '@provablehq/sdk'

/**
 * Slots in a `MerkleProof.siblings` array.
 *
 * Slots 0 and 1 hold the leaf and its pair, consumed together by the leaf-layer
 * hash; every slot above holds one sibling per level. Sixteen slots therefore
 * carry fifteen levels, the maximum the verifier walks, and a shallower tree
 * leaves the tail at `0field`. The Sealance library defaults this width to 15,
 * which is one slot short of the deployed ABI.
 */
const SIBLING_SLOTS = 16

/** Shared instance; the class is stateless apart from its Poseidon hasher. */
const sealance = new SealanceMerkleTree()

/**
 * One Merkle non-inclusion path, shaped as the `MerkleProof` struct.
 *
 * @property siblings Sixteen `field` literals. Slot 0 is the leaf itself, slot
 *   1 its pair, and slots 2 upward one sibling per level; unused tail slots are
 *   `0field`, which is how the verifier infers the tree's depth.
 * @property leaf_index Position of the leaf the path starts from. Its binary
 *   digits, read from the least significant, give the left/right turns up the
 *   tree.
 */
export interface MerkleProofInput {
  siblings: string[]
  leaf_index: number
}

/**
 * Raised when the subject of an exclusion proof is itself on the freezelist.
 *
 * No proof exists in that case: a non-inclusion argument needs two adjacent
 * leaves the address falls strictly between, and a listed address occupies one
 * of them. Surfacing it here avoids submitting a transaction that the verifier
 * is certain to reject after the fee is paid.
 *
 * @property address The address found on the list.
 * @property leafIndex Position of the matching leaf in the tree.
 */
export class FrozenAddressError extends Error {
  readonly address: string
  readonly leafIndex: number

  constructor(address: string, leafIndex: number) {
    super(`Address is on the freezelist at leaf ${leafIndex}, so no exclusion proof exists: ${address}`)
    this.name = 'FrozenAddressError'
    this.address = address
    this.leafIndex = leafIndex
  }
}

/**
 * Parameters for {@link buildExclusionProof}.
 *
 * @property tree The freezelist, either as `getFreezeList` returns it — decimal
 *   field elements, leaf row first, root last — or already decoded by
 *   {@link prepareFreezeList}. Pass the decoded form when cutting several
 *   proofs from one list, which skips a decode worth several milliseconds on a
 *   large list.
 * @property address The address whose absence from the list is proved.
 */
export type BuildExclusionProofParameters = {
  tree: string[] | PreparedFreezeList
  address: string
}

/**
 * The `[MerkleProof; 2]` pair a compliance-gated transition takes: paths from
 * the leaf below the address and the leaf above it.
 */
export type BuildExclusionProofReturnType = readonly [MerkleProofInput, MerkleProofInput]

/**
 * Finds the first leaf greater than or equal to `value`.
 *
 * The leaf row is sorted ascending, so a binary search settles the bracket in
 * logarithmic time rather than the linear scan the Sealance library performs.
 * Returns `leaves.length` when every leaf is smaller.
 */
function lowerBound(leaves: bigint[], value: bigint): number {
  let lo = 0
  let hi = leaves.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (leaves[mid]! < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * A freezelist tree decoded once, ready for repeated proof construction.
 *
 * Decoding a full 32768-leaf tree parses 65535 decimal strings, which costs
 * several milliseconds — thousands of times more than cutting a path from it.
 * A single `mint` proves three addresses against one list, so callers building
 * more than one proof, or holding a cached list, should decode once and pass
 * the result.
 *
 * @property nodes Every tree entry as a field value, leaf row first.
 * @property leafCount Size of the leaf row, always a power of two of at least 2.
 * @property root The Merkle root, as the decimal string the list was read with.
 *   Changes on every list update, which makes it the natural cache key.
 */
export type PreparedFreezeList = {
  nodes: bigint[]
  leafCount: number
  root: string
}

/**
 * Decodes a freezelist tree and checks its shape.
 *
 * Applies when several proofs are cut from one list, or when a caller caches a
 * list across calls — {@link buildExclusionProof} accepts the result directly
 * and skips the decode. Pure and local.
 *
 * @param tree The freezelist as `getFreezeList` returns it.
 * @returns The decoded tree, its leaf count, and its root.
 * @throws {RangeError} When the length cannot describe a perfect binary tree. A
 *   tree of `n` leaves serialises to `2n - 1` entries and `n` must be a power
 *   of two of at least 2, because the verifier's first operation is a leaf-pair
 *   hash and no smaller tree exists.
 *
 * @example
 * const list = prepareFreezeList(await client.getFreezeList({ programId }))
 * const signerProofs = buildExclusionProof({ tree: list, address: signer })
 * const recipientProofs = buildExclusionProof({ tree: list, address: recipient })
 */
export function prepareFreezeList(tree: string[]): PreparedFreezeList {
  const leafCount = tree.length % 2 === 1 && tree.length >= 3 ? (tree.length + 1) / 2 : 0
  if (leafCount < 2 || (leafCount & (leafCount - 1)) !== 0) {
    throw new RangeError(
      `Freezelist tree has ${tree.length} entries, which is not 2n - 1 for a power-of-two leaf count`,
    )
  }
  return {
    nodes: sealance.convertTreeToBigInt(tree),
    leafCount,
    root: tree[tree.length - 1]!,
  }
}

/**
 * Builds the Merkle non-inclusion proof pair that proves an address is absent
 * from a compliance freezelist.
 *
 * Absence is argued by bracketing: the address's field value falls strictly
 * between two leaves that sit at consecutive positions, and consecutive
 * integers leave no position for it to occupy. When the address lies outside
 * the whole range, both paths point at the same boundary leaf and the verifier
 * takes a one-sided comparison instead.
 *
 * Pure and local — every value comes from the supplied tree, so nothing is
 * hashed and no network call is made. Applies after reading the list with
 * `getFreezeList`; the result feeds the `[MerkleProof; 2]` arguments on
 * transitions such as `mint`, `collect` and `claim_swap_output`.
 *
 * @param params The freezelist and the address to clear. Passing a
 *   {@link PreparedFreezeList} skips the decode; passing the raw tree decodes
 *   it on every call.
 * @returns The proof pair, left-hand neighbour first. Each path carries
 *   sixteen `field` literals regardless of the tree's depth.
 * @throws {FrozenAddressError} When the address is itself on the list, where no
 *   proof exists.
 * @throws {RangeError} When the tree's length cannot describe a perfect binary
 *   tree, or when a path does not fill exactly sixteen slots.
 *
 * @example
 * const tree = await client.getFreezeList({
 *   programId: 'shield_swap_freezelist.aleo',
 * })
 * const proofs = buildExclusionProof({ tree, address: account.address })
 */
export function buildExclusionProof(
  params: BuildExclusionProofParameters,
): BuildExclusionProofReturnType {
  const { tree, address } = params

  const { nodes, leafCount } = Array.isArray(tree) ? prepareFreezeList(tree) : tree
  const leaves = nodes.slice(0, leafCount)
  const value = sealance.convertAddressToField(address)

  // The bracket: the first leaf at or above the address, and the one before it.
  const at = lowerBound(leaves, value)
  if (at < leafCount && leaves[at] === value) throw new FrozenAddressError(address, at)

  let left: number
  let right: number
  if (at === leafCount) {
    // Above every leaf. The verifier checks `value > siblings[0]` and requires
    // the index to be the last leaf, so both paths point there.
    left = leafCount - 1
    right = leafCount - 1
  } else if (at === 0) {
    // Below every leaf, reachable only when the row carries no 0field padding.
    left = 0
    right = 0
  } else {
    left = at - 1
    right = at
  }

  return Object.freeze([toProof(nodes, left), toProof(nodes, right)] as const)
}

/**
 * Cuts one sibling path from the tree and renders it as `field` literals.
 *
 * @param nodes The whole tree as field values.
 * @param leafIndex Leaf the path starts from.
 * @throws {RangeError} When the path does not fill exactly sixteen slots, which
 *   would make the struct malformed on chain.
 */
function toProof(nodes: bigint[], leafIndex: number): MerkleProofInput {
  const path = sealance.getSiblingPath(nodes, leafIndex, SIBLING_SLOTS)
  if (path.siblings.length !== SIBLING_SLOTS) {
    throw new RangeError(
      `Merkle path for leaf ${leafIndex} filled ${path.siblings.length} slots, expected ${SIBLING_SLOTS}`,
    )
  }
  return {
    siblings: path.siblings.map((sibling) => `${sibling}field`),
    leaf_index: path.leaf_index,
  }
}
