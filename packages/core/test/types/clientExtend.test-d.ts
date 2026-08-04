import { describe, it, expectTypeOf } from 'vitest'
import { createClient } from '../../src/clients/createClient.js'
import type { Client, Extended } from '../../src/clients/createClient.js'
import type { PublicClient } from '../../src/clients/createPublicClient.js'
import type { WalletClient } from '../../src/clients/createWalletClient.js'
import { custom } from '../../src/transports/custom.js'

/**
 * Locks the behaviour of `Client`'s action-set parameter.
 *
 * Every case here guards a regression that has actually happened: `extend` once
 * returned `Client & extended`, which dropped earlier layers from the type while
 * working fine at runtime, and a later default of `undefined` left `keyof Client`
 * unusable so `Omit`/`Pick`/`Exclude` against it silently collapsed. Both
 * typechecked against source and failed only for consumers of the built package,
 * which is why they belong in a test rather than in review.
 */

// A real client, so `extend` runs for real rather than being stubbed; the casts
// only borrow the richer types. No action is ever invoked, so the transport is
// never reached.
const base: Client = createClient({ transport: custom({ request: async () => null }) })
const wallet = base as unknown as WalletClient
const publicClient = base as unknown as PublicClient

describe('Client action-set parameter', () => {
  describe('extend preserves earlier layers', () => {
    it('keeps wallet actions and the record provider after one extend', () => {
      const extended = wallet.extend(() => ({ ping: () => 'pong' as const }))
      expectTypeOf(extended.ping).toBeFunction()
      expectTypeOf(extended.writeContract).toBeFunction()
      expectTypeOf(extended.signMessage).toBeFunction()
      expectTypeOf(extended).toHaveProperty('recordProvider')
    })

    it('keeps every layer across chained extends', () => {
      const chained = wallet
        .extend(() => ({ first: () => 1 as const }))
        .extend(() => ({ second: () => 2 as const }))
      expectTypeOf(chained.first).toBeFunction()
      expectTypeOf(chained.second).toBeFunction()
      expectTypeOf(chained.writeContract).toBeFunction()
    })

    it('stays assignable to the client type it started from', () => {
      const chained = wallet.extend(() => ({ first: () => 1 as const }))
      expectTypeOf(chained).toMatchTypeOf<WalletClient>()
    })

    it('keeps public actions after extending a public client', () => {
      const extended = publicClient.extend(() => ({ ping: () => 'pong' as const }))
      expectTypeOf(extended.getBlockNumber).toBeFunction()
      expectTypeOf(extended.readMapping).toBeFunction()
      expectTypeOf(extended).toMatchTypeOf<PublicClient>()
    })

    it('lets a decorator build on the layer beneath it', () => {
      const composed = wallet
        .extend(() => ({ inner: () => 1 as const }))
        .extend((client) => ({ outer: () => client.inner() }))
      expectTypeOf(composed.outer).returns.toEqualTypeOf<1>()
    })
  })

  describe('the guard on what a decorator may contribute', () => {
    it('rejects replacing the transport request function', () => {
      // @ts-expect-error a decorator may not shadow `request`
      wallet.extend(() => ({ request: (() => undefined) as unknown }))
    })

    it('rejects replacing the client identity', () => {
      // @ts-expect-error a decorator may not shadow `uid`
      wallet.extend(() => ({ uid: 'not-a-real-uid' }))
    })

    it('rejects a base field supplied as an explicit action set', () => {
      // @ts-expect-error `uid` belongs to the base client, not to an action set
      expectTypeOf<Client<{ uid: string }>>().toBeObject()
    })

    it('rejects non-object action sets', () => {
      // @ts-expect-error a primitive is not an action set
      expectTypeOf<Client<string>>().toBeObject()
      // @ts-expect-error `undefined` is not an action set
      expectTypeOf<Client<undefined>>().toBeObject()
    })

    it('accepts an action set that collides with nothing', () => {
      expectTypeOf<Client<{ ping: () => void }>>().toHaveProperty('ping')
    })
  })

  describe('the bare form stays a usable object type', () => {
    it('exposes the base fields', () => {
      expectTypeOf(base.uid).toBeString()
      expectTypeOf(base.request).toBeFunction()
      expectTypeOf(base).toHaveProperty('transport')
    })

    it('keeps keyof resolvable, so key-level derivations work', () => {
      // `never` here — the symptom of a deferred conditional in the default —
      // silently turns Omit/Pick/Exclude against Client into no-ops.
      expectTypeOf<keyof Client>().not.toBeNever()
      expectTypeOf<'uid'>().toMatchTypeOf<keyof Client>()
    })

    it('supports subtracting the base fields from a parameterized client', () => {
      type Actions = Omit<WalletClient, keyof Client>
      expectTypeOf<Actions>().toHaveProperty('writeContract')
      expectTypeOf<Actions>().not.toHaveProperty('uid')
      expectTypeOf<Actions>().not.toHaveProperty('extend')
    })

    it('still satisfies an index-signature target', () => {
      // Lost if `Client` is ever converted from a type alias to an interface.
      expectTypeOf(base).toMatchTypeOf<Record<string, unknown>>()
    })
  })

  describe('Extended', () => {
    it('names the constraint an action set must meet', () => {
      expectTypeOf<{ ping: () => void }>().toMatchTypeOf<Extended>()
    })
  })
})
