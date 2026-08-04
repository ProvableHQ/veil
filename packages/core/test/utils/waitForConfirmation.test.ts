import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Client } from '../../src/clients/createClient.js'
import { waitForConfirmation } from '../../src/utils/waitForConfirmation.js'
import { FinalizeRevertError, TransactionTimeoutError, TransportError } from '../../src/errors/errors.js'

const TX = 'at1xyz'

/** Client answering `getConfirmedTransaction` from a scripted sequence. */
function pollingClient(answers: Array<unknown | (() => never)>): { client: Client; calls: () => number } {
  let i = 0
  return {
    client: {
      request: async () => {
        const answer = answers[Math.min(i++, answers.length - 1)]
        if (typeof answer === 'function') (answer as () => never)()
        return answer
      },
    } as unknown as Client,
    calls: () => i,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('waitForConfirmation', () => {
  it('returns the inner transaction once confirmed', async () => {
    const { client } = pollingClient([{ status: 'accepted', transaction: { id: TX } }])
    expect(await waitForConfirmation(client, TX, 10_000)).toEqual({ id: TX })
  })

  it('throws FinalizeRevertError without waiting out the window', async () => {
    const { client, calls } = pollingClient([{ status: 'rejected', transaction: { id: TX } }])
    await expect(waitForConfirmation(client, TX, 600_000)).rejects.toBeInstanceOf(FinalizeRevertError)
    // One poll, not a full window: a rejection is terminal.
    expect(calls()).toBe(1)
  })

  it('counts a 404 as the node reporting the transaction absent', async () => {
    vi.useFakeTimers()
    const notFound = () => {
      throw new TransportError('HTTP 404: not found', { status: 404 })
    }
    const { client } = pollingClient([notFound])
    const pending = waitForConfirmation(client, TX, 12_000).catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    const error = await pending

    expect(error).toBeInstanceOf(TransactionTimeoutError)
    // The distinction that matters: the node answered every time and did not
    // have it, rather than the polls failing to reach the node.
    expect((error as TransactionTimeoutError).absentPolls).toBe((error as TransactionTimeoutError).polls)
    expect((error as Error).message).toMatch(/absent on all \d+ polls/)
  })

  it('does not count an unreachable node as absence', async () => {
    vi.useFakeTimers()
    const unreachable = () => {
      throw new TransportError('HTTP 503: upstream unavailable', { status: 503 })
    }
    const { client } = pollingClient([unreachable])
    const pending = waitForConfirmation(client, TX, 12_000).catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    const error = (await pending) as TransactionTimeoutError

    expect(error).toBeInstanceOf(TransactionTimeoutError)
    expect(error.absentPolls).toBe(0)
    expect(error.message).toContain('did not reach the node')
  })

  it('survives a rejection carrying no status at all', async () => {
    vi.useFakeTimers()
    // Reading `.status` off the caught value directly throws a TypeError on a
    // null rejection, which would escape the loop whose whole purpose is
    // surviving transient failures — the timeout must still be what surfaces.
    const nullReject = () => {
      throw null as unknown as Error
    }
    const { client } = pollingClient([nullReject])
    const pending = waitForConfirmation(client, TX, 12_000).catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    const error = (await pending) as TransactionTimeoutError

    expect(error).toBeInstanceOf(TransactionTimeoutError)
    // A rejection with no status is not evidence the node reported it absent.
    expect(error.absentPolls).toBe(0)
    expect(error.polls).toBeGreaterThan(0)
  })

  it('defaults to a one-minute window', async () => {
    vi.useFakeTimers()
    const { client } = pollingClient([null])
    const pending = waitForConfirmation(client, TX).catch((e) => e)
    await vi.advanceTimersByTimeAsync(70_000)
    expect(((await pending) as TransactionTimeoutError).timeoutMs).toBe(60_000)
  })

  it('treats a null answer as absent, the same as a 404', async () => {
    vi.useFakeTimers()
    const { client } = pollingClient([null])
    const pending = waitForConfirmation(client, TX, 12_000).catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    const error = (await pending) as TransactionTimeoutError

    expect(error.absentPolls).toBe(error.polls)
  })
})
