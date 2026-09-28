import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, custom } from '@provablehq/veil-core'
import { shieldSwapActions } from '../../../src/decorators/shieldSwapActions.js'

const handle = { swapId: '7field', program: 'handle_dex.aleo' }
const output = '{ recipient: aleo1recipient, caller: aleo1recipient, token_in: 1field, token_out: 2field, amount_out: 9u128, amount_remaining: 0u128 }'
function fixture() {
  const request = vi.fn(async (_request: unknown): Promise<string | null> => output)
  const client = createClient({ transport: custom({ request }) })
    .extend(shieldSwapActions({ program: 'different_default.aleo' }))
  return { client, request }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
describe('waitForSwapOutput', () => {
  it('returns the decoded output immediately, using the handle program', async () => {
    const { client, request } = fixture()
    expect(await client.waitForSwapOutput({ handle })).toMatchObject({ amount_out: 9n })
    expect(request).toHaveBeenCalledExactlyOnceWith({ method: 'getMappingValue', params: {
      programId: handle.program, mapping: 'swap_outputs', key: handle.swapId,
    } })
  })
  it('polls absent output without signing or submitting a transaction', async () => {
    const { client, request } = fixture()
    request.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const result = client.waitForSwapOutput({ handle, pollingInterval: 10, timeout: 100 })
    await vi.advanceTimersByTimeAsync(20)
    expect(await result).toMatchObject({ amount_out: 9n })
    expect(request).toHaveBeenCalledTimes(3)
  })
  it('times out without starting another read or leaving a polling timer', async () => {
    const { client, request } = fixture()
    request.mockResolvedValue(null)
    const result = client.waitForSwapOutput({ handle, pollingInterval: 10, timeout: 15 })
    const rejected = expect(result).rejects.toThrow(/7field.*recover/i)
    await vi.advanceTimersByTimeAsync(15)
    await rejected
    expect(request).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('propagates transport errors immediately', async () => {
    const { client, request } = fixture()
    request.mockRejectedValue(new Error('node unavailable'))
    await expect(client.waitForSwapOutput({ handle })).rejects.toThrow('node unavailable')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('honors an explicit program override', async () => {
    const { client, request } = fixture()
    await client.waitForSwapOutput({ handle, program: 'override.aleo' })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ programId: 'override.aleo' }) }))
  })
  it.each([0, -1, Infinity, NaN])('rejects invalid timing option %s before reading', async (value) => {
    const { client, request } = fixture()
    await expect(client.waitForSwapOutput({ handle, timeout: value })).rejects.toThrow('timeout')
    await expect(client.waitForSwapOutput({ handle, pollingInterval: value })).rejects.toThrow('pollingInterval')
    expect(request).not.toHaveBeenCalled()
  })
  it('requires a resolved swap id before reading', async () => {
    const { client, request } = fixture()
    await expect(client.waitForSwapOutput({ handle: { program: handle.program } })).rejects.toThrow('swapId')
    expect(request).not.toHaveBeenCalled()
  })
})
