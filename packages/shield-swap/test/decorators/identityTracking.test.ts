import { describe, it, expect, vi } from 'vitest'
import { createClient, custom } from '@provablehq/veil-core'
import type { BlindedIdentityStore } from '../../src/utils/blinding/store.js'

const swapSpy = vi.hoisted(() => vi.fn(async () => ({ swapId: '1field' })))
vi.mock('../../src/actions/swap/swap.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/actions/swap/swap.js')>()),
  swap: swapSpy,
}))

const { shieldSwapActions } = await import('../../src/decorators/shieldSwapActions.js')

/** Params `swap` was called with, which is where the wiring is observable. */
const paramsFromLastSwap = () => swapSpy.mock.calls.at(-1)![1] as { blindedIdentities?: BlindedIdentityStore }

const client = (config: Parameters<typeof shieldSwapActions>[0] = {}) =>
  createClient({ transport: custom({ request: async () => null }) }).extend(shieldSwapActions(config))

const swapArgs = { poolKey: '1field', tokenInId: '11field', amountIn: 1n }

describe('identity tracking through the decorator', () => {
  it('gives swap a store even when none is configured', async () => {
    // The default is what makes two concurrent `client.swap()` calls safe with no
    // configuration at all, so its absence would be a silent regression.
    await client().swap(swapArgs)
    expect(paramsFromLastSwap().blindedIdentities).toBeDefined()
  })

  it('honours a per-call undefined as an opt-out', async () => {
    // Truthiness would inject the default over the top of this, which reads as
    // "track anyway" — the opposite of what the caller wrote.
    await client().swap({ ...swapArgs, blindedIdentities: undefined })
    const params = paramsFromLastSwap()
    expect('blindedIdentities' in params).toBe(true)
    expect(params.blindedIdentities).toBeUndefined()
  })

  it('lets a per-call store win over the configured one', async () => {
    const configured: BlindedIdentityStore = { load: async () => [], save: async () => {} }
    const perCall: BlindedIdentityStore = { load: async () => [], save: async () => {} }
    await client({ blindedIdentities: configured }).swap({ ...swapArgs, blindedIdentities: perCall })
    expect(paramsFromLastSwap().blindedIdentities).toBe(perCall)
  })

  it('passes the configured store when the call says nothing', async () => {
    const configured: BlindedIdentityStore = { load: async () => [], save: async () => {} }
    await client({ blindedIdentities: configured }).swap(swapArgs)
    expect(paramsFromLastSwap().blindedIdentities).toBe(configured)
  })
})
