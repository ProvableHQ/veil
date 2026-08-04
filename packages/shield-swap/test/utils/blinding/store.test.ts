import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import {
  memoryBlindedIdentityStore,
  recordBlindedSwap,
  reserveBlindedIdentity,
  syncBlindedIdentities,
  type BlindedIdentityRecord,
} from '../../../src/utils/blinding/store.js'
import { fileBlindedIdentityStore } from '../../../src/node.js'

const ADDRESS_A = 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'
const ADDRESS_B = 'aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t'
const OUTPUT =
  `{\n  recipient: ${ADDRESS_A},\n  caller: ${ADDRESS_A},\n  token_in: 1field,\n` +
  `  token_out: 2field,\n  amount_out: 500u128,\n  amount_remaining: 0u128\n}`

/**
 * Scripted client: which blinded addresses the chain has consumed, and which
 * swap ids still have an output entry.
 */
function fakeClient(used: string[], outputs: string[]): Client {
  return {
    request: async (req: { method: string; params?: { mapping?: string; key?: string } }) => {
      if (req.method !== 'getMappingValue') throw new Error(`unexpected method ${req.method}`)
      const key = req.params?.key ?? ''
      if (req.params?.mapping === 'used_blinded_addresses') return used.includes(key) ? 'true' : null
      if (req.params?.mapping === 'swap_outputs') return outputs.includes(key) ? OUTPUT : null
      return null
    },
  } as unknown as Client
}

/**
 * The signing account. Its address is a fixture; its view key is generated per
 * run and never checked in — the derivation needs a well-formed view key, and
 * no key material belongs in the repo. These assertions are about counters and
 * distinctness rather than golden vectors, so a random one serves
 * (`identity.test.ts` pins the vectors against a scalar).
 */
let local: { type: 'local'; address: string; viewKey: string }

beforeAll(async () => {
  const { PrivateKey } = await import('@provablehq/sdk')
  local = { type: 'local', address: ADDRESS_A, viewKey: new PrivateKey().to_view_key().to_string() }
})

const reserved = (blindedAddress: string, counter: number, swapId?: string): BlindedIdentityRecord => ({
  counter,
  blindingFactor: `${counter}scalar`,
  blindedAddress,
  status: 'reserved',
  ...(swapId ? { swapId } : {}),
})

describe('blinded identity stores', () => {
  it('round-trips records in memory without sharing the caller’s array', async () => {
    const seed = [reserved(ADDRESS_A, 0)]
    const store = memoryBlindedIdentityStore(seed)
    seed.push(reserved(ADDRESS_B, 1))
    // Mutating the seed after construction must not reach the store, or a
    // caller's stale array silently becomes the reservation ledger.
    expect(await store.load()).toHaveLength(1)

    await store.save([reserved(ADDRESS_A, 0), reserved(ADDRESS_B, 1)])
    expect((await store.load()).map((r) => r.counter)).toEqual([0, 1])
  })

  it('reads an absent file as empty and round-trips through disk', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'veil-blinded-')), 'nested', 'blinded.json')
    const store = fileBlindedIdentityStore(path)
    // Absent means "nothing reserved yet" — the only read failure that may
    // restart counters at 0.
    expect(await store.load()).toEqual([])

    await store.save([reserved(ADDRESS_A, 7, 'swap1field')])
    const loaded = await store.load()
    expect(loaded).toEqual([
      { counter: 7, blindingFactor: '7scalar', blindedAddress: ADDRESS_A, status: 'reserved', swapId: 'swap1field' },
    ])
    // Parent directories are created on first save.
    expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(1)
  })

  it('refuses to treat a malformed file as empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'veil-blinded-'))
    const bad = join(dir, 'bad.json')
    await fileBlindedIdentityStore(bad).save([])
    await (await import('node:fs/promises')).writeFile(bad, '{ not json')
    await expect(fileBlindedIdentityStore(bad).load()).rejects.toThrow(/not valid JSON/)

    const object = join(dir, 'object.json')
    await (await import('node:fs/promises')).writeFile(object, '{"counter":1}')
    await expect(fileBlindedIdentityStore(object).load()).rejects.toThrow(/array of records/)
  })
})

describe('reserveBlindedIdentity', () => {
  /** Client with a local account, answering the used-address mapping. */
  const localClient = (used: string[] = []) =>
    ({ ...(fakeClient(used, []) as object), account: local }) as unknown as Client

  it('hands concurrent callers distinct counters', async () => {
    // The whole point. Without serialization both calls read the same empty
    // store, derive counter 0, and the second swap reverts on finalize against
    // the program's uniqueness assert.
    const store = memoryBlindedIdentityStore()
    const client = localClient()
    const [a, b, c] = await Promise.all([
      reserveBlindedIdentity(client, { store }),
      reserveBlindedIdentity(client, { store }),
      reserveBlindedIdentity(client, { store }),
    ])
    expect([a.counter, b.counter, c.counter].sort()).toEqual([0, 1, 2])
    expect(new Set([a.blindedAddress, b.blindedAddress, c.blindedAddress]).size).toBe(3)
    expect(await store.load()).toHaveLength(3)
  })

  it('continues from the highest stored counter, confirmed or not', async () => {
    // A still-reserved (unconfirmed) counter must not be handed out again, so
    // the frontier is the maximum counter, not the maximum settled one.
    const store = memoryBlindedIdentityStore([reserved(ADDRESS_A, 4)])
    const record = await reserveBlindedIdentity(localClient(), { store })
    expect(record.counter).toBe(5)
  })

  it('skips counters the chain already carries', async () => {
    // Recovers a store that another process has moved past: counter 0 derives
    // an address the chain knows, so reservation advances instead of handing
    // back an identity that would revert.
    const store = memoryBlindedIdentityStore()
    const first = await reserveBlindedIdentity(localClient(), { store })
    expect(first.counter).toBe(0)

    const fresh = memoryBlindedIdentityStore()
    const second = await reserveBlindedIdentity(localClient([first.blindedAddress]), { store: fresh })
    expect(second.counter).toBe(1)
  })

  it('throws past the scan bound rather than reusing a counter', async () => {
    // Learn what counters 0 and 1 derive to, then tell the chain both are
    // already used: with maxScan 2 there is nowhere left to go, and the only
    // wrong answer would be handing one of them back anyway.
    const seen = memoryBlindedIdentityStore()
    const zero = await reserveBlindedIdentity(localClient(), { store: seen })
    const one = await reserveBlindedIdentity(localClient(), { store: seen })

    const client = localClient([zero.blindedAddress, one.blindedAddress])
    await expect(
      reserveBlindedIdentity(client, { store: memoryBlindedIdentityStore(), maxScan: 2 }),
    ).rejects.toThrow(/No unused blinded address in counters 0…1/)
  })

  it('refuses a wallet account, which tracks its own identities', async () => {
    const client = {
      ...(fakeClient([], []) as object),
      account: { type: 'rpc', address: local.address },
    } as unknown as Client
    await expect(reserveBlindedIdentity(client, { store: memoryBlindedIdentityStore() })).rejects.toThrow(
      /requires a local account/,
    )
  })
})

describe('syncBlindedIdentities', () => {
  it('leaves an identity reserved until its address appears on chain', async () => {
    const store = memoryBlindedIdentityStore([reserved(ADDRESS_A, 0, 'swap1field')])
    const [record] = await syncBlindedIdentities(fakeClient([], []), { store })
    expect(record!.status).toBe('reserved')
    // Reconciled state is written back, not just returned.
    expect((await store.load())[0]!.status).toBe('reserved')
  })

  it('marks a consumed identity swapped while its output is unclaimed', async () => {
    const store = memoryBlindedIdentityStore([reserved(ADDRESS_A, 0, 'swap1field')])
    const [record] = await syncBlindedIdentities(fakeClient([ADDRESS_A], ['swap1field']), { store })
    expect(record!.status).toBe('swapped')
  })

  it('marks a consumed identity claimed once its output is gone', async () => {
    const store = memoryBlindedIdentityStore([reserved(ADDRESS_A, 0, 'swap1field')])
    const [record] = await syncBlindedIdentities(fakeClient([ADDRESS_A], []), { store })
    expect(record!.status).toBe('claimed')
  })

  it('reports a consumed identity with no swap id as swapped', async () => {
    // Without a swap id the two consumed states are indistinguishable, so the
    // reconciliation must not claim the stronger one.
    const store = memoryBlindedIdentityStore([reserved(ADDRESS_A, 0)])
    const [record] = await syncBlindedIdentities(fakeClient([ADDRESS_A], []), { store })
    expect(record!.status).toBe('swapped')
  })

  it('does not re-read terminal records', async () => {
    let reads = 0
    const client = {
      request: async () => {
        reads++
        return null
      },
    } as unknown as Client
    const store = memoryBlindedIdentityStore([{ ...reserved(ADDRESS_A, 0), status: 'claimed' }])
    const [record] = await syncBlindedIdentities(client, { store })
    expect(record!.status).toBe('claimed')
    expect(reads).toBe(0)
  })

  it('attaches a swap id to the matching reservation only', async () => {
    const store = memoryBlindedIdentityStore([reserved(ADDRESS_A, 0), reserved(ADDRESS_B, 1)])
    await recordBlindedSwap(store, { blindedAddress: ADDRESS_B, swapId: 'swap9field' })
    const records = await store.load()
    expect(records.find((r) => r.blindedAddress === ADDRESS_A)!.swapId).toBeUndefined()
    expect(records.find((r) => r.blindedAddress === ADDRESS_B)!.swapId).toBe('swap9field')

    // An unknown address is ignored rather than an error, so replaying is safe.
    await expect(recordBlindedSwap(store, { blindedAddress: 'aleo1nope', swapId: 'x' })).resolves.toBeUndefined()
    expect(await store.load()).toHaveLength(2)
  })
})
