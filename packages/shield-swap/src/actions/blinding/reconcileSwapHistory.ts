import { getProgramCallsPaginated, getTransaction, type Client, type Transition } from '@provablehq/veil-core'
import { DEFAULT_PROGRAM } from '../../constants.js'
import type { PersistedMultiHopSwapHandle, PersistedSwapHandle } from '../../utils/blinding/handles.js'
import {
  withStoreLock,
  type BlindedIdentityRecord,
  type BlindedIdentityStore,
} from '../../utils/blinding/store.js'

/** Function whose calls carry a blinded address and the swap id it settled. */
const CLAIM_FUNCTION = 'claim_swap_output'

/**
 * The request functions, whose calls carry everything a claim needs.
 *
 * `used_blinded_addresses` is written by `finalize_swap`, not by the claim — so an
 * identity the chain reports used but no claim names is a swap that landed and was
 * never collected. Its request transaction is what makes it collectable again:
 * pool, amounts, nonce, deadline, and token ids are public inputs, and the swap id
 * is a public output. Only the blinding factor is private, and that is derived
 * locally from the view key and counter, which the store already holds.
 */
const REQUEST_FUNCTIONS = ['swap', 'swap_multi_hop'] as const

/**
 * Input positions of `swap`, from the program's signature:
 * `(token_in_record, blinding_factor, blinded_address, pool, zero_for_one,
 * amount_in, amount_out_min, sqrt_price_limit, nonce, deadline, token0_id,
 * token1_id)`.
 */
const SWAP_INPUT = {
  blindedAddress: 2,
  pool: 3,
  zeroForOne: 4,
  amountIn: 5,
  sqrtPriceLimit: 7,
  nonce: 8,
  token0Id: 10,
  token1Id: 11,
} as const

/**
 * Input positions of `swap_multi_hop`:
 * `(blinding_factor, blinded_address, token_in_record, token_in, token_out,
 * amount_in, amount_out_min, hop0, hop1, hop2, hop_count, nonce, deadline)`.
 */
const MULTI_HOP_INPUT = {
  blindedAddress: 1,
  tokenIn: 3,
  tokenOut: 4,
  amountIn: 5,
  amountOutMin: 6,
  hops: [7, 8, 9] as const,
  hopCount: 10,
  nonce: 11,
  deadline: 12,
} as const

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
 * @property requests Swap requests matched to identities whose swap id was
 *   unknown. Each carries what was sold and, for a single-hop swap, a handle the
 *   store can claim with — which is what turns an abandoned swap back into
 *   collectable funds.
 * @property updated Records whose status or swap id changed.
 * @property callsScanned Calls examined, claims and others alike.
 * @property pagesScanned Pages of history walked.
 * @property complete Whether the walk ended because it ran out of history or
 *   resolved every identity, rather than because it hit a `maxPages` the caller
 *   set. When `false`, older claims may exist beyond the bound.
 */
export type ReconcileSwapHistoryReturnType = {
  claims: ReconciledClaim[]
  requests: RecoveredRequest[]
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

/** Strips an Aleo suffix and reads the integer (`175488u128` → `175488n`). */
function toInt(value: string): bigint {
  return BigInt(value.replace(/[iu]\d+$/, ''))
}

/** Reads a `{ lo, hi }` u256 struct value out of a transition input. */
function toU256(value: string): bigint {
  const lo = /lo:\s*(\d+)/.exec(value)?.[1]
  const hi = /hi:\s*(\d+)/.exec(value)?.[1]
  if (lo === undefined || hi === undefined) return 0n
  return (BigInt(hi) << 128n) + BigInt(lo)
}

/**
 * What a swap request revealed on chain: the swap id and enough to claim it.
 *
 * @property blindedAddress The identity the request registered.
 * @property swapId The request's public output, and the `swap_outputs` key.
 * @property amountIn Base units sold — the figure no claim reports.
 * @property handle Everything a claim consumes except the blinding factor, which
 *   is private and derived locally instead.
 */
export type RecoveredRequest = {
  blindedAddress: string
  swapId: string
  amountIn: bigint
  handle: Omit<PersistedSwapHandle, 'blindingFactor'> | Omit<PersistedMultiHopSwapHandle, 'blindingFactor'> | null
}

/**
 * Reads a `SwapHop` struct out of a transition input.
 *
 * The struct is public, so a multi-hop route is as recoverable as a single-hop
 * one — `{ pool, zero_for_one, sqrt_price_limit: { lo, hi } }`. An empty slot
 * (hop2 on a two-hop route) reads as a zero pool and is skipped by the caller.
 */
function toHop(value: string | undefined): { poolKey: string; zeroForOne: boolean; sqrtPriceLimit: string } | null {
  if (!value) return null
  const pool = /pool:\s*(\d+field)/.exec(value)?.[1]
  if (!pool || pool === '0field') return null
  return {
    poolKey: pool,
    zeroForOne: /zero_for_one:\s*true/.test(value),
    sqrtPriceLimit: toU256(value).toString(),
  }
}

/** Reads a single-hop request out of its transition, or `null` if malformed. */
function requestFromTransition(
  transition: Transition,
  transactionId: string,
  program: string,
): RecoveredRequest | null {
  const inputs = transition.inputs ?? []
  const outputs = transition.outputs ?? []
  // The swap id is the transition's first public output.
  const swapId = outputs.find((output) => output.type === 'public')?.value
  if (!swapId) return null

  // Positions differ between the two functions, and the multi-hop record sits
  // where the single-hop blinded address does. Reading before branching finds a
  // record input, which carries no value, and loses the swap entirely.
  if (transition.function === 'swap_multi_hop') {
    const mhAddress = inputs[MULTI_HOP_INPUT.blindedAddress]?.value
    const mhAmount = inputs[MULTI_HOP_INPUT.amountIn]?.value
    const tokenIn = inputs[MULTI_HOP_INPUT.tokenIn]?.value
    const tokenOut = inputs[MULTI_HOP_INPUT.tokenOut]?.value
    if (!mhAddress || !mhAmount) return null

    // Each hop's pool and price bound are public too, so a route is as
    // recoverable as a single pool. The empty third slot on a two-hop route reads
    // as a zero pool and drops out here.
    const hops = MULTI_HOP_INPUT.hops
      .map((position) => toHop(inputs[position]?.value))
      .filter((hop): hop is NonNullable<typeof hop> => hop !== null)
    const amountOutMin = inputs[MULTI_HOP_INPUT.amountOutMin]?.value
    const nonce = inputs[MULTI_HOP_INPUT.nonce]?.value
    const deadline = inputs[MULTI_HOP_INPUT.deadline]?.value
    const recoverable = tokenIn && tokenOut && hops.length >= 2 && amountOutMin && nonce && deadline

    return {
      blindedAddress: mhAddress,
      swapId: toFieldLiteral(swapId),
      amountIn: toInt(mhAmount),
      handle: recoverable
        ? {
            swapId: toFieldLiteral(swapId),
            blindedAddress: mhAddress,
            tokenInId: toFieldLiteral(tokenIn),
            tokenOutId: toFieldLiteral(tokenOut),
            poolKeys: hops.map((hop) => hop.poolKey),
            hops,
            amountIn: toInt(mhAmount).toString(),
            amountOutMin: toInt(amountOutMin).toString(),
            nonce: toInt(nonce).toString(),
            deadline: Number(toInt(deadline)),
            transactionId,
            program,
          }
        : null,
    }
  }

  const address = inputs[SWAP_INPUT.blindedAddress]?.value
  const amountIn = inputs[SWAP_INPUT.amountIn]?.value
  if (!address || !amountIn) return null

  const pool = inputs[SWAP_INPUT.pool]?.value
  const token0 = inputs[SWAP_INPUT.token0Id]?.value
  const token1 = inputs[SWAP_INPUT.token1Id]?.value
  const zeroForOne = inputs[SWAP_INPUT.zeroForOne]?.value === 'true'
  if (!pool || !token0 || !token1) return null

  const sqrtPriceLimit = inputs[SWAP_INPUT.sqrtPriceLimit]?.value
  const nonce = inputs[SWAP_INPUT.nonce]?.value
  return {
    blindedAddress: address,
    swapId: toFieldLiteral(swapId),
    amountIn: toInt(amountIn),
    handle: {
      swapId: toFieldLiteral(swapId),
      blindedAddress: address,
      // zero_for_one says which side was sold, so the pair resolves without the
      // registry.
      tokenInId: toFieldLiteral(zeroForOne ? token0 : token1),
      tokenOutId: toFieldLiteral(zeroForOne ? token1 : token0),
      poolKey: toFieldLiteral(pool),
      amountIn: toInt(amountIn).toString(),
      zeroForOne,
      ...(sqrtPriceLimit ? { sqrtPriceLimit: toU256(sqrtPriceLimit).toString() } : {}),
      ...(nonce ? { nonce: toInt(nonce).toString() } : {}),
      transactionId,
      program,
    },
  }
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
    const requests: RecoveredRequest[] = []
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

      // Claims settle an identity; requests reveal what it swapped and how to
      // claim it. Both are worth a fetch, and a rejected call is worth neither
      // since it changed nothing.
      const candidates = page.calls.filter(
        (call) =>
          call.status.toLowerCase() === 'accepted' &&
          (call.function_id === CLAIM_FUNCTION ||
            (REQUEST_FUNCTIONS as readonly string[]).includes(call.function_id)),
      )
      // Fetched in parallel, applied in order: the requests are independent but
      // the store must end up the same whatever order they complete in.
      const fetched = await mapWithLimit(candidates, concurrency, async (call) => {
        const transaction = await withRetry(() => getTransaction(client, { id: call.transaction_id }))
        // A call the listing named but the node cannot return tells us nothing;
        // the walk continues rather than failing over one absent transaction.
        const transitions = transaction?.execution?.transitions ?? []
        const claimTransition = transitions.find(
          (candidate) => candidate.program === program && candidate.function === CLAIM_FUNCTION,
        )
        if (claimTransition) {
          return {
            claim: claimFromTransition(claimTransition, call.transaction_id, call.block_number),
            request: null,
          }
        }
        const requestTransition = transitions.find(
          (candidate) =>
            candidate.program === program &&
            (REQUEST_FUNCTIONS as readonly string[]).includes(candidate.function),
        )
        return {
          claim: null,
          request: requestTransition
            ? requestFromTransition(requestTransition, call.transaction_id, program)
            : null,
        }
      })

      // Requests first, so an identity that has both keeps the claim's verdict:
      // a request says a swap happened, a claim says it was settled.
      for (const { request } of fetched) {
        if (!request) continue
        const record = known.get(request.blindedAddress)
        if (!record || record.swapId) continue
        requests.push(request)
        known.set(request.blindedAddress, {
          ...record,
          swapId: request.swapId,
          // The handle is what a claim consumes, and the blinding factor the store
          // already holds is the one private piece chain cannot supply.
          ...(request.handle
            ? { handle: { ...request.handle, blindingFactor: record.blindingFactor } }
            : {}),
          soldAmountIn: request.amountIn.toString(),
        })
        // Still unresolved: knowing the swap id does not say whether it settled.
      }

      for (const { claim } of fetched) {
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

    if (updated.length || marked || requests.length) await params.store.save([...known.values()])
    return { claims, requests, updated, callsScanned, pagesScanned, complete }
  })
}
