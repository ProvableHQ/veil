import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, custom } from '@provablehq/veil-core'
import { shieldSwapActions } from '../../../src/decorators/shieldSwapActions.js'

const handle = { swapId: '7field', program: 'handle_dex.aleo', transactionId: 'at1swap' }
const output = '{ recipient: aleo1recipient, caller: aleo1recipient, token_in: 1field, token_out: 2field, amount_out: 9u128, amount_remaining: 0u128 }'
function fixture() {
  const confirmation = vi.fn(async (): Promise<unknown> => ({ status: 'accepted', transaction: { id: handle.transactionId } }))
  const mapping = vi.fn(async (): Promise<string | null> => output)
  const request = vi.fn(async (request: { method: string }) => request.method === 'getConfirmedTransaction' ? confirmation() : mapping())
  const client = createClient({ transport: custom({ request }) })
    .extend(shieldSwapActions({ program: 'different_default.aleo' }))
  return { client, request, confirmation, mapping }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
describe('waitForSwapOutput', () => {
  it('returns the decoded output immediately, using the handle program', async () => {
    const { client, request } = fixture()
    expect(await client.waitForSwapOutput({ handle })).toMatchObject({ amount_out: 9n })
    expect(request).toHaveBeenNthCalledWith(2, { method: 'getMappingValue', params: {
      programId: handle.program, mapping: 'swap_outputs', key: handle.swapId,
    } })
  })
  it('polls absent output without signing or submitting a transaction', async () => {
    const { client, request, mapping } = fixture()
    mapping.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const result = client.waitForSwapOutput({ handle, pollingInterval: 10, timeout: 100 })
    await vi.advanceTimersByTimeAsync(20)
    expect(await result).toMatchObject({ amount_out: 9n })
    expect(request).toHaveBeenCalledTimes(4)
  })
  it('times out without starting another read or leaving a polling timer', async () => {
    const { client, request, mapping } = fixture()
    mapping.mockResolvedValue(null)
    const result = client.waitForSwapOutput({ handle, pollingInterval: 10, timeout: 15 })
    const rejected = expect(result).rejects.toThrow(/7field.*recover/i)
    await vi.advanceTimersByTimeAsync(15)
    await rejected
    expect(request).toHaveBeenCalledTimes(3)
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
  it('waits for acceptance before reading output and does not reconfirm each mapping poll', async () => {
    const { client, confirmation, mapping } = fixture()
    confirmation.mockResolvedValueOnce(null)
    mapping.mockResolvedValueOnce(null)
    const result = client.waitForSwapOutput({ handle, pollingInterval: 10, timeout: 100 })
    await vi.advanceTimersByTimeAsync(0)
    expect(mapping).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20)
    expect(await result).toMatchObject({ amount_out: 9n })
    expect(confirmation).toHaveBeenCalledTimes(2)
    expect(mapping).toHaveBeenCalledTimes(2)
  })
  it('fails immediately on rejection without reading the output mapping', async () => {
    const { client, confirmation, mapping } = fixture()
    confirmation.mockResolvedValue({ status: 'rejected', transaction: { id: 'at1fee' } })
    await expect(client.waitForSwapOutput({ handle })).rejects.toMatchObject({ name: 'FinalizeRevertError', transactionId: handle.transactionId, feeTransactionId: 'at1fee' })
    expect(mapping).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('treats a confirmation 404 as pending', async () => {
    const { client, confirmation } = fixture()
    confirmation.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }))
    const result = client.waitForSwapOutput({ handle, pollingInterval: 10 })
    await vi.advanceTimersByTimeAsync(10)
    expect(await result).toMatchObject({ amount_out: 9n })
  })
  it('shares one deadline between confirmation and output visibility', async () => {
    const { client, confirmation, mapping } = fixture()
    confirmation.mockResolvedValueOnce(null)
    mapping.mockResolvedValue(null)
    const result = client.waitForSwapOutput({ handle, pollingInterval: 10, timeout: 15 })
    const rejected = expect(result).rejects.toThrow(/7field.*recover/i)
    await vi.advanceTimersByTimeAsync(15)
    await rejected
    expect(confirmation).toHaveBeenCalledTimes(2)
    expect(mapping).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('requires a transaction id before reading', async () => {
    const { client, request } = fixture()
    await expect(client.waitForSwapOutput({ handle: { ...handle, transactionId: '' } })).rejects.toThrow('transactionId')
    expect(request).not.toHaveBeenCalled()
  })
  it('requires a resolved swap id before reading', async () => {
    const { client, request } = fixture()
    await expect(client.waitForSwapOutput({ handle: { program: handle.program, transactionId: handle.transactionId } })).rejects.toThrow('swapId')
    expect(request).not.toHaveBeenCalled()
  })
})
