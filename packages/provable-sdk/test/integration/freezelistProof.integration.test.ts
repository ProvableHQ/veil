import { describe, expect, it } from 'vitest'
import { SealanceMerkleTree } from '@provablehq/sdk'
import { createPublicClient, http } from '@provablehq/veil-core'

import {
  buildExclusionProof,
  prepareFreezeList,
  type MerkleProofInput,
} from '@provablehq/veil-aleo-sdk'

/**
 * Live proof construction against the populated edge testnet freezelist.
 *
 * Run with:
 *   VEIL_INTEGRATION=1 pnpm vitest run packages/provable-sdk/test/integration/freezelistProof.integration.test.ts
 */

const RUN = process.env.VEIL_INTEGRATION === '1'
const EDGE_API_URL = 'https://edge.provable.com/api/v2'
const PROGRAM_ID = 'testnet_freezelist.aleo'
const SUBJECT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'

const sealance = new SealanceMerkleTree()
const stripField = (literal: string): bigint => BigInt(literal.replace(/field$/, ''))
const hashPair = (prefix: string, left: string, right: string): string =>
  sealance.hashTwoElements(prefix, left, right).toString()

/** Recomputes one path with the deployed verifier's domain separators and index-bit ordering. */
function calculateRootAndDepth(proof: MerkleProofInput): { root: string; depth: number } {
  const bitAt = (level: number): number => Math.floor(proof.leaf_index / 2 ** level) % 2
  let root = bitAt(0) === 0
    ? hashPair('1field', proof.siblings[0]!, proof.siblings[1]!)
    : hashPair('1field', proof.siblings[1]!, proof.siblings[0]!)

  for (let slot = 2; slot <= 15; slot++) {
    if (proof.siblings[slot] === '0field') return { root, depth: slot - 1 }
    root = bitAt(slot - 1) === 0
      ? hashPair('0field', root, proof.siblings[slot]!)
      : hashPair('0field', proof.siblings[slot]!, root)
  }
  return { root, depth: 15 }
}

describe.runIf(RUN)('freezelist exclusion proof against the live edge API', () => {
  it('reconstructs the API-supplied root and proves a test address is outside the list', async () => {
    const client = createPublicClient({ transport: http(EDGE_API_URL, { network: 'testnet' }) })
    const tree = await client.getFreezeList({ programId: PROGRAM_ID })
    const prepared = prepareFreezeList(tree)
    const [left, right] = buildExclusionProof({ tree: prepared, address: SUBJECT })

    const leftPath = calculateRootAndDepth(left)
    const rightPath = calculateRootAndDepth(right)
    const expectedRoot = `${prepared.root}field`

    expect(leftPath.root).toBe(expectedRoot)
    expect(rightPath.root).toBe(expectedRoot)
    expect(leftPath.depth).toBe(Math.log2(prepared.leafCount))
    expect(rightPath.depth).toBe(leftPath.depth)

    const subject = sealance.convertAddressToField(SUBJECT)
    if (left.leaf_index === right.leaf_index) {
      const lastLeafIndex = prepared.leafCount - 1
      if (left.leaf_index === 0) {
        expect(subject).toBeLessThan(stripField(left.siblings[0]!))
      } else {
        expect(left.leaf_index).toBe(lastLeafIndex)
        expect(subject).toBeGreaterThan(stripField(left.siblings[0]!))
      }
    } else {
      expect(left.leaf_index + 1).toBe(right.leaf_index)
      expect(subject).toBeGreaterThan(stripField(left.siblings[0]!))
      expect(subject).toBeLessThan(stripField(right.siblings[0]!))
    }
  }, 15_000)
})
