import { describe, expect, it, vi } from 'vitest'
import { getContract } from '../../src/contract/getContract.js'
import type { InputRequest } from '../../src/types/inputRequest.js'

function mockWalletClient() {
  const writeContract = vi.fn().mockResolvedValue('at1tx')
  return { client: { writeContract } as any, writeContract }
}

describe('resolveInputs passthrough (no ABI / legacy)', () => {
  it('encodes literals and passes InputRequests through untouched', async () => {
    const { client, writeContract } = mockWalletClient()
    const c = getContract({ program: 'credits.aleo', client })

    const recReq: InputRequest = { type: 'record', program: 'credits.aleo', recordname: 'credits', uid: 'u1' }
    await c.write.transfer_private!({ inputs: [recReq, { type: 'address' }, '100u64'] })

    expect(writeContract).toHaveBeenCalledTimes(1)
    const sent = writeContract.mock.calls[0]![0].inputs
    expect(sent[0]).toEqual(recReq) // request object preserved, not stringified
    expect(sent[1]).toEqual({ type: 'address' })
    expect(sent[2]).toBe('100u64') // literal preserved
  })

  it('encodes a pure-literal call the same as before (fast path)', async () => {
    const { client, writeContract } = mockWalletClient()
    const c = getContract({ program: 'credits.aleo', client })
    await c.write.transfer_public!({ inputs: ['aleo1abc', '100u64'] })
    expect(writeContract.mock.calls[0]![0].inputs).toEqual(['aleo1abc', '100u64'])
  })
})
