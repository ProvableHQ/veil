import { describe, it, expect, vi } from 'vitest'
import { withRetry, mapWithLimit, isTransientError } from '../../src/utils/concurrency.js'

/** The shape undici throws when the peer resets a socket mid-request. */
function connectionReset(): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) })
}

describe('isTransientError', () => {
  it('recognises rate limits and server errors by status', () => {
    expect(isTransientError({ status: 429 })).toBe(true)
    expect(isTransientError({ status: 500 })).toBe(true)
    expect(isTransientError({ status: 503 })).toBe(true)
  })

  it('treats client errors as answers, not failures', () => {
    expect(isTransientError({ status: 400 })).toBe(false)
    expect(isTransientError({ status: 404 })).toBe(false)
    expect(isTransientError(new Error('positions is not iterable'))).toBe(false)
  })

  it('recognises connection-level fetch failures by their cause code', () => {
    expect(isTransientError(connectionReset())).toBe(true)
    expect(isTransientError(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))).toBe(true)
    expect(isTransientError(new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } }))).toBe(true)
    expect(isTransientError(new TypeError('fetch failed'))).toBe(true)
  })
})

describe('withRetry', () => {
  it('returns the first successful result without waiting', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    expect(await withRetry(fn, { attempts: 3, baseDelayMs: 0 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries a connection reset and returns the eventual result', async () => {
    const fn = vi.fn().mockRejectedValueOnce(connectionReset()).mockRejectedValueOnce(connectionReset()).mockResolvedValue(42)
    expect(await withRetry(fn, { attempts: 3, baseDelayMs: 0 })).toBe(42)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('gives up after the last attempt with the last error', async () => {
    const fn = vi.fn().mockRejectedValue(connectionReset())
    await expect(withRetry(fn, { attempts: 2, baseDelayMs: 0 })).rejects.toThrow('fetch failed')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-transient error', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('HTTP 404'), { status: 404 }))
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 0 })).rejects.toThrow('HTTP 404')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('mapWithLimit', () => {
  it('keeps at most `limit` calls in flight and preserves order', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 20 }, (_, i) => i)
    const results = await mapWithLimit(items, 4, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      return n * 2
    })
    expect(peak).toBe(4)
    expect(results).toEqual(items.map((n) => n * 2))
  })

  it('handles an empty list and a limit larger than the list', async () => {
    expect(await mapWithLimit([], 8, async (n: number) => n)).toEqual([])
    expect(await mapWithLimit([1, 2], 8, async (n) => n + 1)).toEqual([2, 3])
  })

  it('rejects with the first failure', async () => {
    await expect(
      mapWithLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
  })
})
