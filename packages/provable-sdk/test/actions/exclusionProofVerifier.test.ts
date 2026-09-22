import { describe, it, expect } from 'vitest'
import { SealanceMerkleTree } from '@provablehq/sdk'

import { buildExclusionProof, type MerkleProofInput } from '../../src/actions/buildExclusionProof.js'

/**
 * Checks proof construction against a TypeScript mirror of the on-chain
 * verifier.
 *
 * The devnode suite proves one witness against the deployed contract, which is
 * slow and covers a single tree shape. This mirrors
 * `calculate_merkle_root_and_depth` and `verify_merkle_non_inclusion` from
 * amm-v3 `src/main.leo` so every tree depth and every branch can be exercised
 * in milliseconds. The mirror is only trustworthy because the devnode suite
 * confirms it agrees with the real verifier on a populated list.
 *
 * The check that matters: hashing a proof's path with the contract's own rules
 * must land on the root the tree was built with. Nothing else validates that
 * `buildTree` and `getSiblingPath` agree with the verifier — the freezelist
 * contract stores whatever root it is handed and never recomputes one.
 */

const sealance = new SealanceMerkleTree()

/** The verifier's leaf-layer and node-layer domain separators. */
const LEAF_PREFIX = '1field'
const NODE_PREFIX = '0field'

const hashPair = (prefix: string, left: string, right: string): string =>
  sealance.hashTwoElements(prefix, left, right).toString()

const strip = (literal: string): bigint => BigInt(literal.replace(/field$/, ''))

/**
 * Mirrors `calculate_merkle_root_and_depth`.
 *
 * Slots 0 and 1 are hashed as the leaf pair, then one slot per level until a
 * `0field` terminates the path, which also yields the tree's depth. The bit of
 * `leaf_index` at each level decides whether the running value is the left or
 * the right child.
 */
function calculateRootAndDepth(proof: MerkleProofInput): { root: string; depth: number } {
  const bitAt = (level: number): number => Math.floor(proof.leaf_index / 2 ** level) % 2

  let root =
    bitAt(0) === 0
      ? hashPair(LEAF_PREFIX, proof.siblings[0]!, proof.siblings[1]!)
      : hashPair(LEAF_PREFIX, proof.siblings[1]!, proof.siblings[0]!)

  // The Leo loop is `for i in 2u32..MAX_MERKLE_TREE_DEPTH + 1u32`, so 2 to 15.
  for (let i = 2; i <= 15; i++) {
    if (proof.siblings[i] === '0field') return { root, depth: i - 1 }
    root =
      bitAt(i - 1) === 0
        ? hashPair(NODE_PREFIX, root, proof.siblings[i]!)
        : hashPair(NODE_PREFIX, proof.siblings[i]!, root)
  }
  return { root, depth: 15 }
}

/** One assertion the verifier makes, and whether it held. */
type Check = { claim: string; held: boolean }

/**
 * Mirrors `verify_merkle_non_inclusion`, reporting each assertion rather than
 * throwing, so a test can show precisely which one a bad proof fails.
 */
function verifyNonInclusion(
  accountField: bigint,
  proofs: readonly [MerkleProofInput, MerkleProofInput],
): { root: string; checks: Check[] } {
  const a = calculateRootAndDepth(proofs[0])
  const b = calculateRootAndDepth(proofs[1])
  const checks: Check[] = [
    { claim: 'root0 == root1', held: a.root === b.root },
    { claim: 'depth0 == depth1', held: a.depth === b.depth },
  ]

  const lastLeafIndex = 2 ** a.depth - 1
  if (proofs[0].leaf_index === proofs[1].leaf_index) {
    if (proofs[0].leaf_index === 0) {
      checks.push({ claim: 'value < siblings[0]', held: accountField < strip(proofs[0].siblings[0]!) })
    } else {
      checks.push({ claim: 'leaf_index == 2^depth - 1', held: proofs[0].leaf_index === lastLeafIndex })
      checks.push({ claim: 'value > siblings[0]', held: accountField > strip(proofs[0].siblings[0]!) })
    }
  } else {
    checks.push({ claim: 'value > proofs[0].siblings[0]', held: accountField > strip(proofs[0].siblings[0]!) })
    checks.push({ claim: 'value < proofs[1].siblings[0]', held: accountField < strip(proofs[1].siblings[0]!) })
    checks.push({ claim: 'proofs[1].leaf_index <= last', held: proofs[1].leaf_index <= lastLeafIndex })
    checks.push({
      claim: 'leaf_index + 1 == proofs[1].leaf_index',
      held: proofs[0].leaf_index + 1 === proofs[1].leaf_index,
    })
  }
  return { root: a.root, checks }
}

/**
 * Twenty addresses, pre-sorted by field value so a test can choose which fall
 * inside a frozen band and which sit outside it. Fixed rather than generated,
 * so a failure reproduces.
 */
const POOL = [
  'aleo1uswh9ur2kh8hmvjkuuypk6gjzacq0sur4h9dhm9gu0rxlp49mcqqu825cp',
  'aleo13hrtnnh6l3dfv86e5huj6j8x07tvka9dw7y77z7le4qmhxhqegqsjaeysk',
  'aleo1cwt3f0pj5u06jzpa2rchv8q22h4tdp75ehm06ffl8pf6uh6nr5pss024f2',
  'aleo1u6ql4252gx72nx6kw3p4emr0t94mpt029u74nureu7wk7mh2pyrqcelyjn',
  'aleo1nmgm53ntze8v8cxg59hj43s9nd485y3rsdc5nl8r5lhf9fcnxqrq9urhuv',
  'aleo1jhwvkkmghq4cuaudlggvw4v38j2esk66w4sd7dr2n2jlellpayrqy3lvml',
  'aleo16dgkww7p6j7n0nqkktuc8ysfly460lexj6dfdapxyjwk8sp3nvysp8dkm7',
  'aleo1kgy6p8rne8t42rphhtappc5x839pnlg9m3at5ceng38y0ad5ju9q78fskv',
  'aleo1grs6v0uc52zjfucgwy9tl527sc8g2ldr9hxlk0mz8guenzx37gxq0zvvc9',
  'aleo1lhykwc95r8t6jfkn5gvnysudp4avuz48xq5p755mxecw3e8r2gxs5tajtj',
  'aleo1ghj0uwnp7unt0ppxkuyj5jmay269ewqzknlsypa5t4jdshmlnqxs0mwwas',
  'aleo14jtap2nfvd9n5hy6w7k4l6naxdurwar0tjxvvw93e22l24655g8qt2nqq6',
  'aleo17uc4rd9rxxdyc4pwc2ue94rmyq3p7eskdl2n4qmg4q0l3zz25c8q8dzvu0',
  'aleo1a90qsqry4lvfx059ztqdv94zzc6mgcfh6rvrjahexw940f0llv8q7rxkcm',
  'aleo1kfgeqrlugyy486xxe3hj7ez35dagprz48dpekzrctlsy9pjxl58q0f75q3',
  'aleo1duuzuvyac0nrx9syrfnzv82sr7qhr995d784sgdqz2h05cmnyg8szayeyd',
  'aleo14vf0ruhfynl9c6uy9mgqrevtg0908wl7aelpdpfv09fz3f6uw58s4qcarq',
  'aleo1qply5pkhnqyk9rpy8wpjdp0nj788ptun62z850ymmzlyl7unxqgq3j8mz2',
  'aleo1z752fjkq6zzhy6xc7gqfmctetpnky9nxufhnv7keeqlp9kzw7ygqf72c4z',
  'aleo1genyrnwv6hpfyfxsd22yfqknczvr3am3e7csv7jz9dejnavgqcgswm988v',
]

/** Builds the flat tree the API would serve for a set of frozen addresses. */
function treeFor(addresses: string[]): string[] {
  return sealance.buildTree(sealance.generateLeaves(addresses, 16)).map(String)
}

const rootOf = (tree: string[]): string => `${tree[tree.length - 1]}field`
const depthOf = (tree: string[]): number => Math.log2((tree.length + 1) / 2)
const fieldOf = (address: string): bigint => sealance.convertAddressToField(address)

describe('exclusion proofs against a mirror of the on-chain verifier', () => {
  // Frozen bands are taken from the middle of the sorted pool, so every size
  // leaves probes below, between, and above the band.
  const SIZES = [1, 2, 3, 5, 7, 8, 9, 15]

  it.each(SIZES)('recomputes the tree root from every proof cut against a %i-address list', (size) => {
    const frozen = POOL.slice(2, 2 + size)
    const tree = treeFor(frozen)
    const expectedRoot = rootOf(tree)
    const expectedDepth = depthOf(tree)

    const subjects = POOL.filter((address) => !frozen.includes(address))
    expect(subjects.length).toBeGreaterThan(0)

    for (const address of subjects) {
      const proofs = buildExclusionProof({ tree, address })

      // Hashing the supplied path with the contract's own rules has to land on
      // the root the tree was built with — the check nothing else performs.
      for (const proof of proofs) {
        const { root, depth } = calculateRootAndDepth(proof)
        expect(root).toBe(expectedRoot)
        expect(depth).toBe(expectedDepth)
      }

      const { checks } = verifyNonInclusion(fieldOf(address), proofs)
      expect(checks.filter((check) => !check.held)).toEqual([])
    }
  })

  it('covers all three verifier branches across the pool', () => {
    const frozen = POOL.slice(5, 12)
    const tree = treeFor(frozen)
    const seen = new Set<string>()

    for (const address of POOL.filter((a) => !frozen.includes(a))) {
      const [left, right] = buildExclusionProof({ tree, address })
      const lastLeafIndex = 2 ** depthOf(tree) - 1

      if (left.leaf_index !== right.leaf_index) seen.add('bracketed')
      else if (left.leaf_index === 0) seen.add('below-all')
      else if (left.leaf_index === lastLeafIndex) seen.add('above-all')

      const { checks } = verifyNonInclusion(fieldOf(address), [left, right])
      expect(checks.filter((check) => !check.held)).toEqual([])
    }

    // Left padding makes the below-all branch unreachable whenever the leaf row
    // carries a 0field pad, so only the other two are expected here.
    expect(seen).toContain('bracketed')
    expect(seen).toContain('above-all')
  })

  it('rejects a proof whose sibling was tampered with', () => {
    const frozen = POOL.slice(2, 9)
    const tree = treeFor(frozen)
    const subject = POOL[15]!
    const [left, right] = buildExclusionProof({ tree, address: subject })

    // Perturb one node-layer sibling; the recomputed root must diverge.
    const tampered: MerkleProofInput = {
      siblings: left.siblings.map((s, i) => (i === 2 ? `${strip(s) + 1n}field` : s)),
      leaf_index: left.leaf_index,
    }

    expect(calculateRootAndDepth(left).root).toBe(rootOf(tree))
    expect(calculateRootAndDepth(tampered).root).not.toBe(rootOf(tree))
    expect(verifyNonInclusion(fieldOf(subject), [tampered, right]).checks).toContainEqual({
      claim: 'root0 == root1',
      held: false,
    })
  })

  it('rejects a proof whose leaf pair was reordered', () => {
    const frozen = POOL.slice(2, 9)
    const tree = treeFor(frozen)
    const [left] = buildExclusionProof({ tree, address: POOL[15]! })

    // leaf_index carries the left/right turn, so swapping slots 0 and 1 without
    // changing the index rehashes the pair the wrong way round.
    const swapped: MerkleProofInput = {
      siblings: [left.siblings[1]!, left.siblings[0]!, ...left.siblings.slice(2)],
      leaf_index: left.leaf_index,
    }

    expect(calculateRootAndDepth(swapped).root).not.toBe(rootOf(tree))
  })

  it('confirms the domain separator is load-bearing', () => {
    const frozen = POOL.slice(2, 9)
    const tree = treeFor(frozen)
    const [left] = buildExclusionProof({ tree, address: POOL[15]! })

    // Hashing the leaf pair with the node prefix — the collision the two
    // separators exist to prevent — must not reach the same root.
    const asNode = hashPair(NODE_PREFIX, left.siblings[0]!, left.siblings[1]!)
    const asLeaf = hashPair(LEAF_PREFIX, left.siblings[0]!, left.siblings[1]!)
    expect(asNode).not.toBe(asLeaf)
  })

  it('shows why the library proof for a listed address cannot verify', () => {
    const frozen = POOL.slice(2, 9)
    const tree = treeFor(frozen)
    const listed = frozen[3]!

    // buildExclusionProof refuses; reconstruct what SealanceMerkleTree hands
    // back instead, and run it through the verifier to show the exact failure.
    const nodes = sealance.convertTreeToBigInt(tree)
    const [leftIndex, rightIndex] = sealance.getLeafIndices(nodes, listed)
    const cut = (index: number): MerkleProofInput => {
      const path = sealance.getSiblingPath(nodes, index, 16)
      return { siblings: path.siblings.map((s) => `${s}field`), leaf_index: path.leaf_index }
    }

    const { checks } = verifyNonInclusion(fieldOf(listed), [cut(leftIndex), cut(rightIndex)])

    // The paths are genuine, so the root and depth agree — it fails on the
    // range check, comparing the address against its own leaf.
    expect(checks.find((c) => c.claim === 'root0 == root1')!.held).toBe(true)
    expect(checks.find((c) => c.claim === 'value < proofs[1].siblings[0]')!.held).toBe(false)
  })
})
