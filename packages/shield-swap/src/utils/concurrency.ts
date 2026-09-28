/**
 * Bounded fan-out and transient-failure retry for read actions that issue many
 * independent requests against one gateway.
 *
 * Shared by `getOwnedPositions` (four mapping reads per position) and
 * `reconcileSwapHistory` (one transaction fetch per claim). Pure; nothing here
 * contacts the network on its own.
 */

/** Connection-level failure codes undici surfaces as the `cause` of `fetch failed`. */
const TRANSIENT_CAUSE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

/**
 * Reports whether an error says nothing about the request and is worth
 * retrying.
 *
 * Transient means the server was busy or the connection broke: a 429, any 5xx,
 * or a `fetch failed` whose cause is a socket-level code such as `ECONNRESET`.
 * A 4xx other than 429 is an answer and is not transient. A `fetch failed`
 * with no cause is treated as transient, since the runtime attaches a cause to
 * every failure it can name and the unnamed ones are network drops.
 *
 * @param error The thrown value, of any shape.
 * @returns `true` when a retry has a reasonable chance of succeeding.
 *
 * @example
 * if (isTransientError(error)) await sleep(250)
 */
export function isTransientError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status
  if (status !== undefined) return status === 429 || status >= 500
  if (!(error instanceof Error)) return false
  if (error.message !== 'fetch failed') return false
  const code = (error.cause as { code?: string } | undefined)?.code
  return code === undefined || TRANSIENT_CAUSE_CODES.has(code)
}

/**
 * Options for {@link withRetry}.
 *
 * @property attempts Total calls to make before giving up, including the first.
 *   Defaults to 4.
 * @property baseDelayMs Wait before the second attempt, doubled on each later
 *   one. Defaults to 250.
 */
export type WithRetryOptions = {
  attempts?: number
  baseDelayMs?: number
}

/**
 * Retries a request the node refused for being busy or dropped mid-flight,
 * rather than for being wrong.
 *
 * A rate limit, a 5xx, or a connection reset says nothing about the request,
 * and a wide fan-out is exactly the shape of traffic that trips one — giving
 * up would discard every sibling request's progress. A 404 or a 400 is not
 * retried: those are answers. Backs off exponentially from `baseDelayMs`.
 *
 * @param fn The request to make; called once per attempt.
 * @param options Attempt count and starting delay. Defaults to four attempts
 *   starting at 250 ms.
 * @returns The first successful result.
 * @throws The last error once every attempt fails, or the first error that is
 *   not transient.
 *
 * @example
 * const tx = await withRetry(() => getTransaction(client, { id }))
 */
export async function withRetry<T>(fn: () => Promise<T>, options: WithRetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 4
  const baseDelayMs = options.baseDelayMs ?? 250
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (!isTransientError(error) || attempt === attempts - 1) throw error
      last = error
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt))
    }
  }
  throw last
}

/**
 * Runs `fn` over `items` with a bounded number in flight, preserving order.
 *
 * A gateway resets connections it cannot serve at once, so a read that fans
 * out one request per item must not open them all together. `limit` workers
 * pull from the list until it is drained; the first rejection rejects the
 * whole call.
 *
 * @param items The inputs, mapped in order.
 * @param limit Calls in flight at once. Values below 1 behave as 1.
 * @param fn The per-item work.
 * @returns The results in the same order as `items`.
 *
 * @example
 * const positions = await mapWithLimit(nfts, 8, (nft) => resolveOwnedPosition(client, { nft, program, slot }))
 */
export async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}
