import { withStoreLock, type BlindedIdentityStore } from '../../utils/blinding/store.js'

/**
 * Attaches a swap id to a reserved blinded identity.
 *
 * The swap id is only known once the swap is built, and without it a consumed
 * identity cannot be told apart from a claimed one — so
 * {@link syncBlindedIdentities} reports every unlabelled consumed identity as
 * `swapped`. Call this with the handle a swap returns.
 *
 * Writes to the store. Does not hit the network. A `blindedAddress` the store
 * does not hold is ignored rather than an error, so replaying a claim is safe.
 *
 * @param store The store holding the reservation.
 * @param params Blinded address to label and the swap id to attach.
 *
 * @example
 * const handle = await client.swap({ poolKey, tokenInId, amountIn, blindedIdentity: identity })
 * await client.recordBlindedSwap({ blindedAddress: identity.blindedAddress, swapId: handle.swapId! })
 */
export async function recordBlindedSwap(
  store: BlindedIdentityStore,
  params: { blindedAddress: string; swapId: string },
): Promise<void> {
  await withStoreLock(store, async () => {
    const records = await store.load()
    await store.save(
      records.map((r) => (r.blindedAddress === params.blindedAddress ? { ...r, swapId: params.swapId } : r)),
    )
  })
}
