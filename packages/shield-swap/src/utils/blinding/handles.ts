import type { SwapHandle } from '../../actions/swap/swap.js'
import type { MultiHopSwapHandle } from '../../actions/swap/swapMultiHop.js'

/**
 * A single-hop swap handle in storable form.
 *
 * Identical to {@link SwapHandle} except that every `bigint` is a decimal
 * string, because `JSON.stringify` throws on `bigint` and a store that cannot
 * be serialised cannot hold a handle. The fields are enumerated rather than
 * mapped from the source type so the wire format is stated, not inferred — a
 * store written by one version has to be readable by the next.
 *
 * @property amountIn Raw base units sold, as a decimal string.
 * @property sqrtPriceLimit Q128.128 price bound as a decimal string, when the
 *   swap carried one.
 * @property nonce Field nonce as a decimal string, when the swap carried one.
 */
export type PersistedSwapHandle = {
  swapId?: string
  blindingFactor?: string
  blindedAddress?: string
  tokenInId: string
  tokenOutId: string
  tokenInWrapped?: boolean
  tokenOutWrapped?: boolean
  poolKey: string
  amountIn: string
  zeroForOne?: boolean
  sqrtPriceLimit?: string
  nonce?: string
  transactionId: string
  program: string
}

/**
 * A multi-hop swap handle in storable form.
 *
 * Same treatment as {@link PersistedSwapHandle}, and additionally flattens the
 * per-hop `sqrtPriceLimit`, which is a `bigint` nested inside an array and so
 * needs converting element by element.
 *
 * @property hops Per-hop route with each price bound as a decimal string.
 * @property deadline Unix seconds; already a `number` and stored as one.
 */
export type PersistedMultiHopSwapHandle = {
  swapId?: string
  blindingFactor?: string
  blindedAddress?: string
  tokenInId: string
  tokenOutId: string
  tokenInWrapped?: boolean
  tokenOutWrapped?: boolean
  poolKeys: string[]
  hops: Array<{ poolKey: string; zeroForOne: boolean; sqrtPriceLimit: string }>
  amountIn: string
  amountOutMin: string
  nonce: string
  deadline: number
  transactionId: string
  program: string
}

/** Either handle in storable form; `poolKeys` distinguishes the multi-hop one. */
export type PersistedHandle = PersistedSwapHandle | PersistedMultiHopSwapHandle

/** True when the handle is a multi-hop route rather than a single pool. */
function isMultiHop(handle: SwapHandle | MultiHopSwapHandle): handle is MultiHopSwapHandle {
  return 'poolKeys' in handle
}

/** True when the stored handle is a multi-hop route. */
export function isPersistedMultiHop(handle: PersistedHandle): handle is PersistedMultiHopSwapHandle {
  return 'poolKeys' in handle
}

/**
 * Converts a swap handle into its storable form.
 *
 * Optional fields are omitted rather than set to `undefined`, so the stored JSON
 * carries only what the swap actually produced and a round trip does not invent
 * keys. Pure and local.
 *
 * @param handle The handle a swap returned, single-hop or multi-hop.
 * @returns The same handle with every `bigint` as a decimal string.
 *
 * @example
 * const handle = await client.swap({ poolKey, tokenInId, amountIn })
 * await store.save([{ ...record, handle: toPersistedHandle(handle) }])
 */
export function toPersistedHandle(handle: SwapHandle | MultiHopSwapHandle): PersistedHandle {
  const shared = {
    ...(handle.swapId !== undefined ? { swapId: handle.swapId } : {}),
    ...(handle.blindingFactor !== undefined ? { blindingFactor: handle.blindingFactor } : {}),
    ...(handle.blindedAddress !== undefined ? { blindedAddress: handle.blindedAddress } : {}),
    tokenInId: handle.tokenInId,
    tokenOutId: handle.tokenOutId,
    ...(handle.tokenInWrapped !== undefined ? { tokenInWrapped: handle.tokenInWrapped } : {}),
    ...(handle.tokenOutWrapped !== undefined ? { tokenOutWrapped: handle.tokenOutWrapped } : {}),
    amountIn: handle.amountIn.toString(),
    transactionId: handle.transactionId,
    program: handle.program,
  }

  if (isMultiHop(handle)) {
    return {
      ...shared,
      poolKeys: [...handle.poolKeys],
      hops: handle.hops.map((hop) => ({
        poolKey: hop.poolKey,
        zeroForOne: hop.zeroForOne,
        sqrtPriceLimit: hop.sqrtPriceLimit.toString(),
      })),
      amountOutMin: handle.amountOutMin.toString(),
      nonce: handle.nonce.toString(),
      deadline: handle.deadline,
    }
  }

  return {
    ...shared,
    poolKey: handle.poolKey,
    ...(handle.zeroForOne !== undefined ? { zeroForOne: handle.zeroForOne } : {}),
    ...(handle.sqrtPriceLimit !== undefined ? { sqrtPriceLimit: handle.sqrtPriceLimit.toString() } : {}),
    ...(handle.nonce !== undefined ? { nonce: handle.nonce.toString() } : {}),
  }
}

/**
 * Rebuilds a swap handle from its storable form, ready for a claim.
 *
 * The inverse of {@link toPersistedHandle}. `claimSwapOutput` takes a whole
 * handle rather than a swap id, so this is what makes a claim possible from a
 * store rather than only from the process that made the swap. Pure and local.
 *
 * @param handle A handle as stored.
 * @returns The handle with decimal strings back as `bigint`.
 * @throws When a numeric field is not a valid integer string, rather than
 *   letting `BigInt` throw a message that names neither the field nor the swap.
 *
 * @example
 * const record = (await store.load()).find((r) => r.status === 'swapped')
 * await client.claimSwapOutput({ handle: fromPersistedHandle(record.handle) })
 */
export function fromPersistedHandle(handle: PersistedHandle): SwapHandle | MultiHopSwapHandle {
  const toBig = (value: string, field: string): bigint => {
    try {
      return BigInt(value)
    } catch (cause) {
      throw new Error(
        `Stored handle for swap ${handle.swapId ?? '(no id)'} has a non-numeric ${field}: ${value}`,
        { cause },
      )
    }
  }

  const shared = {
    ...(handle.swapId !== undefined ? { swapId: handle.swapId } : {}),
    ...(handle.blindingFactor !== undefined ? { blindingFactor: handle.blindingFactor } : {}),
    ...(handle.blindedAddress !== undefined ? { blindedAddress: handle.blindedAddress } : {}),
    tokenInId: handle.tokenInId,
    tokenOutId: handle.tokenOutId,
    ...(handle.tokenInWrapped !== undefined ? { tokenInWrapped: handle.tokenInWrapped } : {}),
    ...(handle.tokenOutWrapped !== undefined ? { tokenOutWrapped: handle.tokenOutWrapped } : {}),
    amountIn: toBig(handle.amountIn, 'amountIn'),
    transactionId: handle.transactionId,
    program: handle.program,
  }

  if (isPersistedMultiHop(handle)) {
    return {
      ...shared,
      poolKeys: [...handle.poolKeys],
      hops: handle.hops.map((hop) => ({
        poolKey: hop.poolKey,
        zeroForOne: hop.zeroForOne,
        sqrtPriceLimit: toBig(hop.sqrtPriceLimit, 'hops[].sqrtPriceLimit'),
      })),
      amountOutMin: toBig(handle.amountOutMin, 'amountOutMin'),
      nonce: toBig(handle.nonce, 'nonce'),
      deadline: handle.deadline,
    }
  }

  return {
    ...shared,
    poolKey: handle.poolKey,
    ...(handle.zeroForOne !== undefined ? { zeroForOne: handle.zeroForOne } : {}),
    ...(handle.sqrtPriceLimit !== undefined
      ? { sqrtPriceLimit: toBig(handle.sqrtPriceLimit, 'sqrtPriceLimit') }
      : {}),
    ...(handle.nonce !== undefined ? { nonce: toBig(handle.nonce, 'nonce') } : {}),
  }
}
