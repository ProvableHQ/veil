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

const requestsOf = (client: unknown) => (client as { request: ReturnType<typeof vi.fn> }).request

describe('freezelistActions', () => {
  it('reads the named program and builds a proof in one call', async () => {
    const client = stubClient()
    const actions = freezelistActions(client)

    const [left, right] = await actions.getExclusionProof({ program: PROGRAM, address: CLEAR })

    expect(left.siblings).toHaveLength(16)
    expect(left.leaf_index + 1).toBe(right.leaf_index)
    expect(requestsOf(client)).toHaveBeenCalledWith({
      method: 'getFreezeList',
      params: { programId: PROGRAM },
    })
  })

  it('reads a different list per call, as a wrapped operation requires', async () => {
    const client = stubClient()
    const actions = freezelistActions(client)

    // A mint against a wrapped pair proves the parties against the AMM's list
    // and the sender against each wrapper's, so the program cannot be fixed to
    // the client.
    await actions.getExclusionProof({ program: PROGRAM, address: CLEAR })
    await actions.getExclusionProof({ program: 'test_usdcx_freezelist.aleo', address: CLEAR })

    expect(requestsOf(client).mock.calls.map(([call]) => call.params.programId)).toEqual([
      PROGRAM,
      'test_usdcx_freezelist.aleo',
    ])
  })

  it('decodes a list once so several parties share one read', async () => {
    const client = stubClient()
    const actions = freezelistActions(client)

    const list = await actions.getFreezeListTree({ program: PROGRAM })

    expect(list.leafCount).toBe(4)
    expect(list.root).toBe(TREE[TREE.length - 1])
    // One read, not one per party — the point of exposing the decoded form.
    expect(requestsOf(client)).toHaveBeenCalledTimes(1)
  })

  it('surfaces a listed address as FrozenAddressError', async () => {
    const actions = freezelistActions(stubClient())

    await expect(actions.getExclusionProof({ program: PROGRAM, address: LISTED })).rejects.toThrow(
      FrozenAddressError,
    )
  })

  it('propagates a malformed tree from the node', async () => {
    const actions = freezelistActions(stubClient(['0', '0']))

    await expect(actions.getExclusionProof({ program: PROGRAM, address: CLEAR })).rejects.toThrow(RangeError)
  })
})
