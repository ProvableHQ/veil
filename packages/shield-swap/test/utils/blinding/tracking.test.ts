import { describe, it, expect, vi } from 'vitest'
import {
  recordSwapOrThrow,
  markClaimedQuietly,
  SwapRecordingError,
} from '../../../src/utils/blinding/tracking.js'
import {
  memoryBlindedIdentityStore,
  type BlindedIdentityRecord,
  type BlindedIdentityStore,
} from '../../../src/utils/blinding/store.js'
import type { SwapHandle } from '../../../src/actions/swap/swap.js'

const ADDRESS = 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'

const handle: SwapHandle = {
  swapId: '7field',
  blindingFactor: '1field',
  blindedAddress: ADDRESS,
  tokenInId: '11field',
  tokenOutId: '22field',
  poolKey: '1field',
  amountIn: 1000n,
  transactionId: 'at1swap',
  program: 'shield_swap.aleo',
}

const reserved = (blindedAddress: string): BlindedIdentityRecord => ({
  counter: 0,
  blindingFactor: '1field',
  blindedAddress,
  status: 'reserved',
})

/** A store whose save always fails, standing in for a full or unwritable disk. */
const brokenStore = (): BlindedIdentityStore => ({
  load: async () => [reserved(ADDRESS)],
  save: async () => {
    throw new Error('EROFS: read-only file system')
  },
})

describe('recordSwapOrThrow', () => {
  it('labels the reservation with the swap and its handle', async () => {
    const store = memoryBlindedIdentityStore([reserved(ADDRESS)])
    await recordSwapOrThrow(store, handle)
    const [record] = await store.load()
    expect(record!.swapId).toBe('7field')
    expect(record!.handle).toMatchObject({ transactionId: 'at1swap', amountIn: '1000' })
  })

  it('carries the handle on the error when the store cannot be written', async () => {
    // The dangerous case: the swap is on chain, so the output is claimable, but
    // the store does not know the swap id and never will — nothing on chain
    // links an identity to its swap until a claim exists. The handle has to
    // escape programmatically, not just in a message.
    const error = await recordSwapOrThrow(brokenStore(), handle).catch((e) => e)
    expect(error).toBeInstanceOf(SwapRecordingError)
    expect((error as SwapRecordingError).handle).toEqual(handle)
    expect((error as Error).message).toContain('do not')
    expect((error as Error).message).toContain('at1swap')
    // The underlying failure is preserved rather than replaced.
    expect((error as Error).cause).toBeInstanceOf(Error)
  })
})

describe('markClaimedQuietly', () => {
  it('marks the identity claimed', async () => {
    const store = memoryBlindedIdentityStore([{ ...reserved(ADDRESS), status: 'swapped' }])
    await markClaimedQuietly(store, ADDRESS)
    expect((await store.load())[0]!.status).toBe('claimed')
  })

  it('never fails a claim whose proceeds already landed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Opposite policy to recordSwapOrThrow, and deliberately so: the funds are
    // already in the account and reconcileSwapHistory can recover the status
    // from the claim call, so throwing would report a success as a failure.
    await expect(markClaimedQuietly(brokenStore(), ADDRESS)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toContain('reconcileSwapHistory')
    warn.mockRestore()
  })

  it('leaves a store that does not hold the identity alone', async () => {
    // A wallet account derives identities the store never saw.
    const store = memoryBlindedIdentityStore([reserved(ADDRESS)])
    await markClaimedQuietly(store, 'aleo1someoneelse')
    expect((await store.load())[0]!.status).toBe('reserved')
  })

  it('does nothing without a blinded address', async () => {
    const store = memoryBlindedIdentityStore([reserved(ADDRESS)])
    await markClaimedQuietly(store, undefined)
    expect((await store.load())[0]!.status).toBe('reserved')
  })
})
