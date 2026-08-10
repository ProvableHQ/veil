import { describe, it, expect, vi } from 'vitest'

import { freezelistActions } from '../../src/decorators/freezelistActions.js'
import { FrozenAddressError } from '../../src/actions/buildExclusionProof.js'

// A real four-leaf tree built with SealanceMerkleTree: one 0field pad and
// three frozen addresses, followed by their two parents and the root.
const TREE = [
  '0',
  '1295133970529764960316948294624974168921228814652993007266766481909235735940',
  '3501665755452795161867664882580888971213780722176652848275908626939553697821',
  '7732720745526335455120695239163343503173104439763988933134571160677908480689',
  '8036827032340734292768185365782913897730051279707199206606726207530725020597',
  '1250996242929444733508568796348789520587026385071822779073752423477566230933',
  '4659655276692415540853997712674706826166146452042294364145428381644360330269',
]

// Frozen: sits at leaf 1.
const LISTED = 'aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t'
// Absent, and falls between two of the entries.
const CLEAR = 'aleo1z3zwzgpgakk89xpknync5rtklkjkyv33g7cvaqe0gku64zs3lv9qyux0qc'

const PROGRAM = 'shield_swap_freezelist.aleo'

/** A client whose transport answers `getFreezeList` with the tree above. */
function stubClient(tree: string[] = TREE) {
  return { request: vi.fn().mockResolvedValue(tree) } as never
}

describe('freezelistActions', () => {
  it('reads the configured program and builds a proof in one call', async () => {
    const client = stubClient()
    const actions = freezelistActions({ program: PROGRAM })(client)

    const [left, right] = await actions.getExclusionProof({ address: CLEAR })

    expect(left.siblings).toHaveLength(16)
    expect(left.leaf_index + 1).toBe(right.leaf_index)
    expect((client as unknown as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith({
      method: 'getFreezeList',
      params: { programId: PROGRAM },
    })
  })

  it('lets a call override the configured program', async () => {
    const client = stubClient()
    const actions = freezelistActions({ program: PROGRAM })(client)

    await actions.getExclusionProof({ address: CLEAR, program: 'test_usdcx_freezelist.aleo' })

    expect((client as unknown as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith({
      method: 'getFreezeList',
      params: { programId: 'test_usdcx_freezelist.aleo' },
    })
  })

  it('decodes a list once so several proofs share one read', async () => {
    const client = stubClient()
    const actions = freezelistActions({ program: PROGRAM })(client)

    const list = await actions.getFreezeListTree()

    expect(list.leafCount).toBe(4)
    expect(list.root).toBe(TREE[TREE.length - 1])
    // One read, not one per party — the point of exposing the decoded form.
    expect((client as unknown as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledTimes(1)
  })

  it('surfaces a listed address as FrozenAddressError', async () => {
    const actions = freezelistActions({ program: PROGRAM })(stubClient())

    await expect(actions.getExclusionProof({ address: LISTED })).rejects.toThrow(FrozenAddressError)
  })

  it('explains the missing program rather than reading an empty id', async () => {
    const client = stubClient()
    const actions = freezelistActions()(client)

    await expect(actions.getExclusionProof({ address: CLEAR })).rejects.toThrow(/No freezelist program/)
    await expect(actions.getFreezeListTree()).rejects.toThrow(/No freezelist program/)
    expect((client as unknown as { request: ReturnType<typeof vi.fn> }).request).not.toHaveBeenCalled()
  })

  it('propagates a malformed tree from the node', async () => {
    const actions = freezelistActions({ program: PROGRAM })(stubClient(['0', '0']))

    await expect(actions.getExclusionProof({ address: CLEAR })).rejects.toThrow(RangeError)
  })
})
