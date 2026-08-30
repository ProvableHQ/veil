import { describe, it, expect, vi } from 'vitest'
import { getFreezeList } from '../../../src/actions/public/getFreezeList.js'

// The live response for an untouched list, as served by
// shield_swap_freezelist.aleo on testnet: two 0field padding leaves and their
// hash. The root matches the constant the program's `initialize` writes.
const EMPTY_LIST = [
  '0',
  '0',
  '3642222252059314292809609689035560016959342421640560347114299934615987159853',
]

describe('getFreezeList', () => {
  it('returns the tree and forwards the program id', async () => {
    const client = { request: vi.fn().mockResolvedValue(EMPTY_LIST) } as any
    const result = await getFreezeList(client, { programId: 'shield_swap_freezelist.aleo' })

    expect(result).toEqual(EMPTY_LIST)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getFreezeList',
      params: { programId: 'shield_swap_freezelist.aleo' },
    })
  })

  it('reads an empty list as a two-leaf tree whose last entry is the root', async () => {
    const client = { request: vi.fn().mockResolvedValue(EMPTY_LIST) } as any
    const tree = await getFreezeList(client, { programId: 'shield_swap_freezelist.aleo' })

    // 2n - 1 entries for n leaves; the padding leaves sort below every address.
    expect(tree).toHaveLength(3)
    expect(tree.slice(0, 2)).toEqual(['0', '0'])
    expect(tree[tree.length - 1]).toBe(EMPTY_LIST[2])
  })

  it('returns a populated tree unparsed, root last', async () => {
    // Seven frozen addresses pad to eight leaves: 8 leaves + 4 + 2 + 1 = 15.
    const tree = Array.from({ length: 15 }, (_unused, i) => String(i + 1))
    const client = { request: vi.fn().mockResolvedValue(tree) } as any
    const result = await getFreezeList(client, { programId: 'shield_swap_freezelist.aleo' })

    expect(result).toEqual(tree)
    expect(result).toHaveLength(15)
  })

  it('surfaces the transport error when a program tracks no freezelist', async () => {
    // A missing list is a 404, distinct from an empty list's two-leaf tree.
    const client = {
      request: vi.fn().mockRejectedValue(new Error('HTTP 404: No current freeze list found')),
    } as any

    await expect(getFreezeList(client, { programId: 'no_such_freezelist.aleo' })).rejects.toThrow(
      'HTTP 404',
    )
  })
})
