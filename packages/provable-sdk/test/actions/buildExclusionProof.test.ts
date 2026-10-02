import { describe, it, expect } from 'vitest'
import { SealanceMerkleTree } from '@provablehq/sdk'
import {
  buildExclusionProof,
  prepareFreezeList,
  FrozenAddressError,
} from '../../src/actions/buildExclusionProof.js'

// A real freezelist: seven frozen addresses padded to eight leaves, built with
// SealanceMerkleTree. Entries 0-7 are the leaf row, 8-11 their parents, 12-13
// the row above, and 14 the root.
const TREE = [
  '0',
  '1994681649786972310030221296588458917853404859233461320701995596554614651366',
  '2556096296969270753204597074923953067824412870954866811076507590127693109976',
  '3402330172195568528691814849814089738287755692809574771680310548266355343373',
  '4050288426785249688859006250005599842514631393521661129314154173020846394198',
  '4341161844036814560634332391108164021174277910664678162699175603638080408183',
  '5367042334779192629056904279190074706659696549936297224896164382584147219862',
  '6021991354483658489147851568791972550901712942917979897702619890964283198959',
  '3611038669425301242919922539943728570885944361396331243778223043644659299405',
  '8264133279631704166590330023704874990353454012876772587858695011403568908250',
  '2720129286449277996938888553438841215463963174613270135017900349678422418606',
  '2001795192551221597217879828129593380236498965874668416762369985657659450800',
  '1491460665602192005634371539137115564998782771566684415273840855365521011500',
  '1615526777695229169270458122556838138733884324992705053235521389123583173323',
  '3007557470214746735571620877725120629869808881514002774322215626242453663503',
]

// The list as testnet serves it today: two 0field padding leaves and their hash.
const EMPTY_TREE = [
  '0',
  '0',
  '3642222252059314292809609689035560016959342421640560347114299934615987159853',
]

const BELOW_ALL = 'aleo1l5n83svrlz2czerk62phewugq4ltkmjha02fawl6pf6yhaqgcgqq2klwyw'
const BETWEEN = 'aleo1zj9uy0p8klqvgxxap6vy22j40p99l799844p9f2xyfe8yp4z0qyquedhfd'
const ABOVE_ALL = 'aleo1nelwc44l0qlsaznk8zxacsty8j5ha4l5hkqyvfmxz945wdv9jsfqhgqelt'
// Present in the list, at leaf 4.
const FROZEN = 'aleo1269uwjvrnuvqa65h5c42z00d8qqukersrzaee5d4l4nh9jmp7syqcrse26'

/** The tree indices a path for `leafIndex` should read, in slot order. */
const expectedSlots = (leafIndex: number): number[] => [
  leafIndex,
  leafIndex ^ 1,
  8 + ((leafIndex >> 1) ^ 1),
  12 + ((leafIndex >> 2) ^ 1),
]

describe('buildExclusionProof', () => {
  it('brackets an address between the two adjacent leaves it falls between', () => {
    const [left, right] = buildExclusionProof({ tree: TREE, address: BETWEEN })

    expect(left.leaf_index).toBe(3)
    expect(right.leaf_index).toBe(4)
    // Adjacency is what forbids a leaf hiding in the gap.
    expect(left.leaf_index + 1).toBe(right.leaf_index)
  })

  it('reads the tree entries the contract walks, in slot order', () => {
    const [left, right] = buildExclusionProof({ tree: TREE, address: BETWEEN })

    for (const [proof, leafIndex] of [
      [left, 3],
      [right, 4],
    ] as const) {
      const slots = expectedSlots(leafIndex)
      expect(proof.siblings.slice(0, 4)).toEqual(slots.map((i) => `${TREE[i]}field`))
      // Everything past the path terminates the verifier's climb.
      expect(proof.siblings.slice(4)).toEqual(Array(12).fill('0field'))
    }
  })

  it('fills exactly sixteen slots, matching the deployed [field; 16] struct', () => {
    for (const address of [BELOW_ALL, BETWEEN, ABOVE_ALL]) {
      for (const proof of buildExclusionProof({ tree: TREE, address })) {
        expect(proof.siblings).toHaveLength(16)
        expect(proof.siblings.every((s) => s.endsWith('field'))).toBe(true)
      }
    }
  })

  it('points both paths at the last leaf when the address is above every entry', () => {
    const [left, right] = buildExclusionProof({ tree: TREE, address: ABOVE_ALL })

    // The verifier asserts leaf_index == 2^depth - 1 in this branch.
    expect(left.leaf_index).toBe(7)
    expect(right.leaf_index).toBe(7)
    expect(left).toEqual(right)
  })

  it('brackets against the padding leaf when the address is below every entry', () => {
    const [left, right] = buildExclusionProof({ tree: TREE, address: BELOW_ALL })

    // Left padding means leaf 0 is 0field, so the [0, 0] branch is unreachable
    // here — the address brackets the pad and the smallest real address.
    expect(left.leaf_index).toBe(0)
    expect(right.leaf_index).toBe(1)
    expect(left.siblings[0]).toBe('0field')
  })

  it('agrees with SealanceMerkleTree on every address that is not on the list', () => {
    const sealance = new SealanceMerkleTree()
    const nodes = sealance.convertTreeToBigInt(TREE)

    for (const address of [BELOW_ALL, BETWEEN, ABOVE_ALL]) {
      const [expectedLeft, expectedRight] = sealance.getLeafIndices(nodes, address)
      const [left, right] = buildExclusionProof({ tree: TREE, address })
      expect([left.leaf_index, right.leaf_index]).toEqual([expectedLeft, expectedRight])
    }
  })

  it('reproduces the empty-tree witness for an untouched list', () => {
    const [left, right] = buildExclusionProof({ tree: EMPTY_TREE, address: BETWEEN })

    // Byte-identical to the EMPTY_MERKLE_PROOF constant the DEX ships, which is
    // why switching to real proofs does not change behaviour while lists are
    // empty. It is a genuine proof against a two-leaf tree, not an escape hatch.
    expect(left).toEqual({ siblings: Array(16).fill('0field'), leaf_index: 1 })
    expect(right).toEqual(left)
  })

  it('rejects an address that is itself on the list', () => {
    expect(() => buildExclusionProof({ tree: TREE, address: FROZEN })).toThrow(FrozenAddressError)

    try {
      buildExclusionProof({ tree: TREE, address: FROZEN })
      expect.unreachable('expected FrozenAddressError')
    } catch (error) {
      expect(error).toBeInstanceOf(FrozenAddressError)
      expect((error as FrozenAddressError).leafIndex).toBe(4)
      expect((error as FrozenAddressError).address).toBe(FROZEN)
    }
  })

  it('does not hand back the unsatisfiable proof SealanceMerkleTree returns for a listed address', () => {
    // The library brackets a listed address with its own leaf, so the verifier's
    // `value < proofs[1].siblings[0]` compares the value against itself.
    const sealance = new SealanceMerkleTree()
    const nodes = sealance.convertTreeToBigInt(TREE)
    const [, right] = sealance.getLeafIndices(nodes, FROZEN)
    expect(nodes[right]).toBe(sealance.convertAddressToField(FROZEN))

    expect(() => buildExclusionProof({ tree: TREE, address: FROZEN })).toThrow(FrozenAddressError)
  })

  it('rejects a tree whose length cannot describe a perfect binary tree', () => {
    for (const tree of [
      [],
      ['0'],
      ['0', '0'],
      ['0', '0', '0', '0'],
      Array(13).fill('0'), // 7 leaves — not a power of two
    ]) {
      expect(() => buildExclusionProof({ tree, address: BETWEEN })).toThrow(RangeError)
      expect(() => prepareFreezeList(tree)).toThrow(RangeError)
    }
  })

  it('produces the same proofs from a decoded list as from the raw tree', () => {
    const prepared = prepareFreezeList(TREE)

    expect(prepared.leafCount).toBe(8)
    expect(prepared.root).toBe(TREE[TREE.length - 1])

    for (const address of [BELOW_ALL, BETWEEN, ABOVE_ALL]) {
      expect(buildExclusionProof({ tree: prepared, address })).toEqual(
        buildExclusionProof({ tree: TREE, address }),
      )
    }
  })

  it('still rejects a listed address when the list was decoded up front', () => {
    const prepared = prepareFreezeList(TREE)
    expect(() => buildExclusionProof({ tree: prepared, address: FROZEN })).toThrow(
      FrozenAddressError,
    )
  })
})
