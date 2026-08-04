import { toPersistedHandle } from '../../utils/blinding/handles.js'
import { withStoreLock, type BlindedIdentityStore } from '../../utils/blinding/store.js'
import type { SwapHandle } from '../swap/swap.js'
import type { MultiHopSwapHandle } from '../swap/swapMultiHop.js'

/**
 * Parameters for {@link recordBlindedSwap}.
 *
 * @property handle The handle a swap returned. Its `blindedAddress` selects the
 *   reservation to label and its `swapId` is attached to it; the rest is stored
 *   so the swap can be claimed later from the store alone.
 */
export type RecordBlindedSwapParameters = {
  handle: SwapHandle | MultiHopSwapHandle
}

/**
 * Attaches a swap and its handle to the reservation that funded it.
 *
 * The swap id is only known once the swap is built, and without it a consumed
 * identity cannot be told apart from a claimed one — so
 * {@link syncBlindedIdentities} reports every unlabelled consumed identity as
 * `swapped`. The handle matters for a different reason: `claimSwapOutput` takes a
 * whole handle rather than a swap id, so storing it is what lets a later process
 * claim proceeds it did not itself swap for.
 *
 * Writes to the store. Does not hit the network. A handle whose `blindedAddress`
 * the store does not hold is ignored rather than an error — that covers wallet
 * accounts, which derive identities the store never saw — and so is a handle with
 * no `blindedAddress` at all.
 *
 * @param store The store holding the reservation.
 * @param params The swap's handle.
 *
 * @example
 * const handle = await client.swap({ poolKey, tokenInId, amountIn, blindedIdentity: identity })
 * await client.recordBlindedSwap({ handle })
 */
export async function recordBlindedSwap(
  store: BlindedIdentityStore,
  params: RecordBlindedSwapParameters,
): Promise<void> {
  const { blindedAddress } = params.handle
  if (!blindedAddress) return
  await withStoreLock(store, async () => {
    const records = await store.load()
    if (!records.some((record) => record.blindedAddress === blindedAddress)) return
    await store.save(
      records.map((record) =>
        record.blindedAddress === blindedAddress
          ? {
              ...record,
              ...(params.handle.swapId !== undefined ? { swapId: params.handle.swapId } : {}),
              handle: toPersistedHandle(params.handle),
            }
          : record,
      ),
    )
  })
}
