import { recordBlindedSwap } from '../../actions/blinding/recordBlindedSwap.js'
import { withStoreLock, type BlindedIdentityStore } from './store.js'
import type { SwapHandle } from '../../actions/swap/swap.js'
import type { MultiHopSwapHandle } from '../../actions/swap/swapMultiHop.js'

/**
 * A swap landed on chain but could not be written to the identity store.
 *
 * The swap succeeded: its input is spent and its output is waiting in
 * `swap_outputs`. Only the local record failed, which matters because a claim
 * consumes a whole handle — so losing the handle means losing access to the
 * proceeds until {@link reconcileSwapHistory} can see them, which it cannot until
 * something claims them. The handle is attached rather than only described, so a
 * caller can persist it themselves and claim with it.
 *
 * Do NOT resubmit the swap in response to this. The transaction is already on
 * chain; a second one spends more input for a second output.
 *
 * @property handle The handle the swap produced — persist this.
 */
export class SwapRecordingError extends Error {
  readonly handle: SwapHandle | MultiHopSwapHandle

  constructor(handle: SwapHandle | MultiHopSwapHandle, cause: unknown) {
    super(
      `Swap ${handle.swapId ?? '(id unknown)'} landed in transaction ${handle.transactionId}, but writing it ` +
        'to the blinded identity store failed. The swap succeeded and its output is claimable — do not ' +
        'resubmit. Persist the handle on this error and pass it to claimSwapOutput, or repair the store ' +
        `later with reconcileSwapHistory once the output is claimed. Blinded address: ${handle.blindedAddress ?? '(none)'}.`,
      cause !== undefined ? { cause } : undefined,
    )
    this.name = 'SwapRecordingError'
    this.handle = handle
  }
}

/**
 * Records a swap against its reservation, turning a write failure into an
 * actionable error rather than a silent gap.
 *
 * Called by `swap` and `swapMultiHop` after a successful submission, and only
 * when a store is configured. A failure here is the one store inconsistency
 * nothing can repair on its own, which is why it surfaces instead of being
 * logged: the swap id is knowable now and unknowable later.
 *
 * @param store The store holding the reservation.
 * @param handle The handle the swap produced.
 * @throws {SwapRecordingError} When the store rejects the write. The swap itself
 *   has already succeeded.
 */
export async function recordSwapOrThrow(
  store: BlindedIdentityStore,
  handle: SwapHandle | MultiHopSwapHandle,
): Promise<void> {
  let recorded: boolean
  try {
    recorded = await recordBlindedSwap(store, { handle })
  } catch (cause) {
    throw new SwapRecordingError(handle, cause)
  }
  // A write that matched nothing is as bad as one that threw: the reservation
  // this swap consumed is missing from the store, so the swap id would be lost
  // just as silently. Only reachable if something replaced the store's contents
  // between the reservation and here.
  if (!recorded) {
    throw new SwapRecordingError(
      handle,
      new Error(`the store holds no reservation for ${handle.blindedAddress ?? '(no address)'}`),
    )
  }
}

/**
 * Marks a claimed identity in the store, reporting a write failure without
 * failing the claim.
 *
 * The asymmetry with {@link recordSwapOrThrow} is deliberate. By the time a claim
 * has confirmed the proceeds are already in the account, and
 * {@link reconcileSwapHistory} can recover the status from the claim call — so a
 * stale store here costs tidiness, not money, and throwing would report a
 * successful claim as a failure.
 *
 * @param store The store holding the reservation.
 * @param blindedAddress The identity whose swap was claimed.
 * @returns Nothing. A store failure is reported on the console and swallowed.
 */
export async function markClaimedQuietly(
  store: BlindedIdentityStore,
  blindedAddress: string | undefined,
): Promise<void> {
  if (!blindedAddress) return
  try {
    // Locked like every other read-modify-write on the store: a concurrent
    // reservation between the load and the save would otherwise drop the mark.
    await withStoreLock(store, async () => {
      const records = await store.load()
      if (!records.some((record) => record.blindedAddress === blindedAddress)) return
      await store.save(
        records.map((record) =>
          record.blindedAddress === blindedAddress ? { ...record, status: 'claimed' as const } : record,
        ),
      )
    })
  } catch (cause) {
    console.warn(
      `Claim succeeded but marking ${blindedAddress} claimed in the blinded identity store failed. ` +
        'The proceeds are in the account; run reconcileSwapHistory to repair the store.',
      cause,
    )
  }
}
