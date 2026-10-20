import type { GenerateFreezelistProofParameters } from '@provablehq/veil-core'
import type * as Sdk from '@provablehq/sdk'

/**
 * Generates an ARC-22 exclusion witness and checks its reconstructed root.
 *
 * Uses the selected network's SDK binaries. Does not fetch, sign, or broadcast.
 * @param sdk SDK module selected by the network handle.
 * @param params Subject, published tree, and authoritative root.
 * @returns An encoded `[MerkleProof; 2]` with 16 fields per path.
 * @throws When the subject is frozen, the tree is malformed, or the root differs.
 * @example
 * const proof = await generateFreezelistProof(sdk, { address, tree, root })
 */
export async function generateFreezelistProof(
  sdk: Pick<typeof Sdk, 'SealanceMerkleTree'>,
  params: GenerateFreezelistProofParameters,
): Promise<string> {
  const merkle = new sdk.SealanceMerkleTree()
  if (!/^\d+field$/.test(params.root) || !params.tree.every(node => /^\d+$/.test(node))) {
    throw new Error('Invalid freezelist root or tree field')
  }
  const nodes = params.tree.length
    ? params.tree.map(BigInt)
    : merkle.buildTree(merkle.generateLeaves([], 16))
  const leaves = (nodes.length + 1) / 2
  if (!Number.isInteger(leaves) || leaves < 2 || leaves > 32768 || (leaves & (leaves - 1)) !== 0) {
    throw new Error('Invalid freezelist tree: expected a complete binary tree with at most 32768 leaves')
  }
  const root = BigInt(params.root.slice(0, -5))
  if (nodes.at(-1) !== root) throw new Error('Published freezelist tree does not match the on-chain root')
  const subject = merkle.convertAddressToField(params.address)
  for (let i = 0; i < leaves; i++) {
    if (nodes[i] === subject) throw new Error('Address is frozen')
    if (i > 0 && nodes[i]! < nodes[i - 1]!) throw new Error('Invalid freezelist tree: leaves must be sorted')
  }

  const proofs = merkle.getLeafIndices(nodes, params.address).map(index => merkle.getSiblingPath(nodes, index, 16))
  // Check each actual witness, not just the root supplied by the indexer.
  for (const proof of proofs) {
    let value = proof.siblings[0]!
    for (let level = 1; level < 16; level++) {
      const sibling = proof.siblings[level]!
      if (level > 1 && sibling === 0n) break
      const right = (proof.leaf_index >> (level - 1)) & 1
      const hash = merkle.hashTwoElements(level === 1 ? '1field' : '0field', `${right ? sibling : value}field`, `${right ? value : sibling}field`)
      try { value = BigInt(hash.toString().slice(0, -5)) } finally { hash.free() }
    }
    if (value !== root) throw new Error('Freezelist witness does not reconstruct the on-chain root')
  }
  return merkle.formatMerkleProof(proofs)
}
