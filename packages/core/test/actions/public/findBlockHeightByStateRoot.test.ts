import { describe, it, expect, vi } from 'vitest'
import { findBlockHeightByStateRoot } from '../../../src/actions/public/findBlockHeightByStateRoot.js'

describe('findBlockHeightByStateRoot', () => {
  it('resolves a state root to a block height', async () => {
    const client = { request: vi.fn().mockResolvedValue(42) } as any
    const result = await findBlockHeightByStateRoot(client, { stateRoot: 'sr1abc' })
    expect(result).toBe(42)
    expect(client.request).toHaveBeenCalledWith({
      method: 'findBlockHeightByStateRoot',
      params: { stateRoot: 'sr1abc' },
    })
  })
})
