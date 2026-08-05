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
 * @property maxPages Pages of call history to walk before giving up. Defaults
 *   to 8. Each page costs one request, plus one per claim call it contains, so
 *   raise it deliberately — a full history walk on a busy deployment is
 *   hundreds of requests.
 * @property pageSize Calls per page, 1–50. Defaults to 50, the largest the
 *   endpoint serves and therefore the fewest requests per call examined.
 */
export type ReconcileSwapHistoryParameters = {
  store: BlindedIdentityStore
  program?: string
  maxPages?: number
  pageSize?: number
}

/**
 * What the walk found and how far it got.
 *
 * @property claims Claims matched to this store's identities, newest first.
 * @property updated Records whose status or swap id changed.
 * @property callsScanned Calls examined, claims and others alike.
 * @property pagesScanned Pages of history walked.
 * @property complete Whether the walk ended because it ran out of history or
 *   resolved every identity, rather than because it hit `maxPages`. When
 *   `false`, older claims may exist and a higher `maxPages` would find them.
 */
export type ReconcileSwapHistoryReturnType = {
  claims: ReconciledClaim[]
  updated: BlindedIdentityRecord[]
  callsScanned: number
  pagesScanned: number
  complete: boolean
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
 * Stops early once every identity is accounted for, so an up-to-date store
 * usually costs one page. Otherwise it walks to `maxPages` and reports
 * `complete: false`.
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
  const maxPages = params.maxPages ?? 8
  const pageSize = params.pageSize ?? 50

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
      const page = await getProgramCallsPaginated(client, {
        programId: program,
        limit: pageSize,
        ...(cursor ? { cursorBlockNumber: cursor.block_number, cursorTransitionId: cursor.transition_id } : {}),
      })
      pagesScanned++
      callsScanned += page.calls.length
      if (page.calls.length === 0) {
        complete = true
        break
      }

      for (const call of page.calls) {
        // A rejected claim consumed nothing, so it says nothing about status.
        if (call.function_id !== CLAIM_FUNCTION || call.status.toLowerCase() !== 'accepted') continue
        const transaction = await getTransaction(client, { id: call.transaction_id })
        const transition = (transaction.execution?.transitions ?? []).find(
          (candidate) => candidate.program === program && candidate.function === CLAIM_FUNCTION,
        )
        if (!transition) continue
        const claim = claimFromTransition(transition, call.transaction_id, call.block_number)
        if (!claim || !unresolved.has(claim.blindedAddress)) continue

        claims.push(claim)
        unresolved.delete(claim.blindedAddress)
        const record = known.get(claim.blindedAddress)!
        const next: BlindedIdentityRecord = { ...record, swapId: claim.swapId, status: 'claimed' }
        known.set(claim.blindedAddress, next)
        updated.push(next)
        if (unresolved.size === 0) break
      }

      if (unresolved.size === 0) complete = true
      else if (!page.next_cursor) complete = true
      else cursor = page.next_cursor
    }

    if (updated.length) await params.store.save([...known.values()])
    return { claims, updated, callsScanned, pagesScanned, complete }
  })
}
