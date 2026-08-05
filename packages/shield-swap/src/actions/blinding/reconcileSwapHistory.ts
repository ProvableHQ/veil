import { getProgramCallsPaginated, getTransaction, type Client, type Transition } from '@provablehq/veil-core'
import { DEFAULT_PROGRAM } from '../../constants.js'
import {
  withStoreLock,
  type BlindedIdentityRecord,
  type BlindedIdentityStore,
} from '../../utils/blinding/store.js'

/** Function whose calls carry a blinded address and the swap id it settled. */
const CLAIM_FUNCTION = 'claim_swap_output'

/**
 * Input positions of `claim_swap_output`, from the program's own signature:
 * `(blinding_factor, blinded_address, swap_id, token_in, token_out, amount_out,
 * amount_remaining, merkle_proofs)`. The first is private and therefore a
 * ciphertext on chain; the rest are public and readable.
 */
const INPUT = {
  blindedAddress: 1,
  swapId: 2,
  tokenIn: 3,
  tokenOut: 4,
  amountOut: 5,
  amountRemaining: 6,
} as const

/**
 * A claim this store's identities were party to, as recorded on chain.
 *
 * @property blindedAddress The identity the claim proved ownership of.
 * @property swapId The swap the claim settled — the `swap_outputs` key, now
 *   removed by that claim.
 * @property tokenIn Token id that was sold.
 * @property tokenOut Token id that was received.
 * @property amountOut Raw base units received (u128).
 * @property amountRemaining Raw base units refunded unfilled (u128).
 * @property transactionId The claim transaction.
 * @property blockNumber Height the claim landed in.
 */
export type ReconciledClaim = {
  blindedAddress: string
  swapId: string
  tokenIn: string
  tokenOut: string
  amountOut: bigint
  amountRemaining: bigint
  transactionId: string
  blockNumber: number
}

/**
 * Parameters for {@link reconcileSwapHistory}.
 *
 * @property store The store to reconcile and write back.
 * @property program shield_swap program whose call history is walked. Defaults
 *   to `DEFAULT_PROGRAM`.
 * @property maxPages Pages of call history to walk before giving up. Unbounded by
 *   default: the walk ends when the history does, which is what makes a rebuilt
 *   store complete rather than partial. Set it to bound the work on a deployment
 *   whose history has grown large — each page costs one request plus one per
 *   claim it contains, though those run concurrently.
 * @property pageSize Calls per page, 1–50. Defaults to 50, the largest the
 *   endpoint serves and therefore the fewest requests per call examined.
 * @property concurrency Transaction fetches in flight at once. Defaults to 8.
 *   Pages are sequential because each needs the previous page's cursor, but the
 *   claims within a page are independent and are the bulk of the work — a page of
 *   50 can mean 50 fetches. Lower it if the node rate-limits; the walk retries
 *   those anyway.
 */
export type ReconcileSwapHistoryParameters = {
  store: BlindedIdentityStore
  program?: string
  maxPages?: number
  pageSize?: number
  concurrency?: number
}

/**
 * What the walk found and how far it got.
 *
 * @property claims Claims matched to this store's identities, newest first.
 * @property updated Records whose status or swap id changed.
 * @property callsScanned Calls examined, claims and others alike.
 * @property pagesScanned Pages of history walked.
 * @property complete Whether the walk ended because it ran out of history or
 *   resolved every identity, rather than because it hit a `maxPages` the caller
 *   set. When `false`, older claims may exist beyond the bound.
 */
export type ReconcileSwapHistoryReturnType = {
  claims: ReconciledClaim[]
  updated: BlindedIdentityRecord[]
  callsScanned: number
  pagesScanned: number
  complete: boolean
}

/**
 * Retries a fetch the node refused for being busy rather than for being wrong.
 *
 * A rate limit or a 5xx says nothing about the request, and a long walk is
 * exactly the shape of traffic that trips one — giving up would discard the whole
 * page's progress. A 404 or a 400 is not retried: those are answers.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      const status = (error as { status?: number } | null)?.status
      const retryable = status === 429 || (status !== undefined && status >= 500)
      if (!retryable || attempt === attempts - 1) throw error
      last = error
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
    }
  }
  throw last
}

/**
 * Runs `fn` over `items` with a bounded number in flight.
 *
 * The walk's cost is dominated by one transaction fetch per claim, and those are
 * independent of each other — running them one at a time makes a long history
 * take minutes it does not need to.
 */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

/** Mapping keys are field literals; the call history reports them bare. */
function toFieldLiteral(value: string): string {
  return /(field|group|scalar)$/.test(value) ? value : `${value}field`
}

/** Strips an Aleo integer suffix (`175488u128` → `175488n`). */
function toBigInt(value: string): bigint {
  return BigInt(value.replace(/[iu]\d+$/, ''))
}

/** Reads a claim out of the core program's transition, or `null` if malformed. */
function claimFromTransition(
  transition: Transition,
  transactionId: string,
  blockNumber: number,
): ReconciledClaim | null {
  const inputs = transition.inputs ?? []
  const address = inputs[INPUT.blindedAddress]?.value
  const swapId = inputs[INPUT.swapId]?.value
  const tokenIn = inputs[INPUT.tokenIn]?.value
  const tokenOut = inputs[INPUT.tokenOut]?.value
  const amountOut = inputs[INPUT.amountOut]?.value
  const amountRemaining = inputs[INPUT.amountRemaining]?.value
  if (!address || !swapId || !tokenIn || !tokenOut || !amountOut || !amountRemaining) return null
  return {
    blindedAddress: address,
    swapId: toFieldLiteral(swapId),
    tokenIn: toFieldLiteral(tokenIn),
    tokenOut: toFieldLiteral(tokenOut),
    amountOut: toBigInt(amountOut),
    amountRemaining: toBigInt(amountRemaining),
    transactionId,
    blockNumber,
  }
}

/**
 * Reconstructs which of the store's identities have had their swaps claimed,
 * by walking the program's `claim_swap_output` history.
 *
 * A claim is the only public record tying a blinded address to the swap it
 * settled: its inputs carry both, plus the token pair and amounts. Nothing else
 * exposes that link — the `swap_outputs` entry is removed by the very claim that
 * settles it, and the identity is derived rather than recorded anywhere the
 * account can see. So a store that has lost track of a swap can recover it only
 * from here.
 *
 * Applies on first run against an existing account, and after losing or
 * replacing a store. Not part of routine reconciliation:
 * {@link syncBlindedIdentities} settles the cheap questions against the
 * mappings, and should be preferred for anything periodic.
 *
 * Identities it could not find are marked `claimSearched` when the walk reached
 * the end of the history, because that is an answer — those swaps were never
 * claimed — and it keeps a later run from searching all of history for them again.
 *
 * Stops early once every identity is accounted for, so an up-to-date store
 * usually costs one page. Otherwise it walks to `maxPages` and reports
 * `complete: false`.
 *
 * Pages are sequential — each needs the previous cursor — but the claims within a
 * page are fetched concurrently and retried through a rate limit, because those
 * fetches are the bulk of a long walk.
 *
 * What it cannot do: find swaps that were never claimed. An unclaimed swap has
 * no claim call by definition, so proceeds still waiting on chain are invisible
 * here — {@link syncBlindedIdentities} and `getSwapOutput` cover those, for
 * identities the store already knows.
 *
 * Hits the network: one request per page, plus one per claim call examined.
 * Writes the reconciled records back to the store.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params Store, program override, and walk bounds.
 * @returns The matched claims, the records that changed, and how far the walk
 *   got.
 *
 * @example
 * // Once, when adopting a store for an account with existing history:
 * const { claims, complete } = await client.reconcileSwapHistory({ maxPages: 40 })
 * if (!complete) console.warn('history walk truncated — raise maxPages')
 */
export async function reconcileSwapHistory(
  client: Client,
  params: ReconcileSwapHistoryParameters,
): Promise<ReconcileSwapHistoryReturnType> {
  const program = params.program ?? DEFAULT_PROGRAM
  const maxPages = params.maxPages ?? Number.POSITIVE_INFINITY
  const pageSize = params.pageSize ?? 50
  const concurrency = params.concurrency ?? 8

  return withStoreLock(params.store, async () => {
    const records = await params.store.load()
    // Identities already `claimed` need nothing from the history; the rest are
    // what the walk is looking for, and finding all of them ends it early.
    const unresolved = new Set(
      records.filter((record) => record.status !== 'claimed').map((record) => record.blindedAddress),
    )
    const known = new Map(records.map((record) => [record.blindedAddress, record]))
    const claims: ReconciledClaim[] = []
    const updated: BlindedIdentityRecord[] = []
    let callsScanned = 0
    let pagesScanned = 0
    let complete = unresolved.size === 0
    let cursor: { block_number: number; transition_id: string } | null = null

    while (!complete && pagesScanned < maxPages) {
      const page = await withRetry(() =>
        getProgramCallsPaginated(client, {
          programId: program,
          limit: pageSize,
          ...(cursor
            ? { cursorBlockNumber: cursor.block_number, cursorTransitionId: cursor.transition_id }
            : {}),
        }),
      )
      pagesScanned++
      callsScanned += page.calls.length
      if (page.calls.length === 0) {
        complete = true
        break
      }

      // A rejected claim consumed nothing, so it says nothing about status and is
      // not worth a fetch.
      const candidates = page.calls.filter(
        (call) => call.function_id === CLAIM_FUNCTION && call.status.toLowerCase() === 'accepted',
      )
      // Fetched in parallel, applied in order: the requests are independent but
      // the store must end up the same whatever order they complete in.
      const fetched = await mapWithLimit(candidates, concurrency, async (call) => {
        const transaction = await withRetry(() => getTransaction(client, { id: call.transaction_id }))
        const transition = (transaction.execution?.transitions ?? []).find(
          (candidate) => candidate.program === program && candidate.function === CLAIM_FUNCTION,
        )
        return transition ? claimFromTransition(transition, call.transaction_id, call.block_number) : null
      })

      for (const claim of fetched) {
        if (!claim || !unresolved.has(claim.blindedAddress)) continue
        claims.push(claim)
        unresolved.delete(claim.blindedAddress)
        const record = known.get(claim.blindedAddress)!
        const next: BlindedIdentityRecord = {
          ...record,
          swapId: claim.swapId,
          status: 'claimed',
          // Persisted because it cannot be re-read: the claim removed the
          // `swap_outputs` entry, so this transaction is the only remaining
          // record of what the swap actually moved.
          claim: {
            tokenIn: claim.tokenIn,
            tokenOut: claim.tokenOut,
            amountOut: claim.amountOut.toString(),
            amountRemaining: claim.amountRemaining.toString(),
            transactionId: claim.transactionId,
            blockNumber: claim.blockNumber,
          },
        }
        known.set(claim.blindedAddress, next)
        updated.push(next)
      }

      if (unresolved.size === 0) complete = true
      else if (!page.next_cursor) complete = true
      else if (
        cursor &&
        page.next_cursor.block_number === cursor.block_number &&
        page.next_cursor.transition_id === cursor.transition_id
      ) {
        // The endpoint handed back the cursor it was given, so paging is not
        // advancing. Stopping beats looping forever on one page.
        complete = true
      } else cursor = page.next_cursor
    }

    // A walk that reached the end of history has answered for everything it did
    // not find: those swaps were never claimed. Recording that is what stops the
    // next run from searching the whole history for them again.
    let marked = 0
    if (complete) {
      for (const address of unresolved) {
        const record = known.get(address)
        if (!record || record.swapId || record.status === 'reserved' || record.claimSearched) continue
        known.set(address, { ...record, claimSearched: true })
        marked++
      }
    }

    if (updated.length || marked) await params.store.save([...known.values()])
    return { claims, updated, callsScanned, pagesScanned, complete }
  })
}
