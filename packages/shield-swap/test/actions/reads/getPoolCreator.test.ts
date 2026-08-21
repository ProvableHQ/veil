import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { getPoolCreator } from '../../../src/actions/reads/getPoolCreator.js'

const CREATOR = 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'
const POOL_KEY = '4719270064611482818245310300232007815222047549513360085395965112315873598024field'

// Scripted client: answers only the pool_creators read.
const fakeClient = (value: string | null): Client =>
  ({
    request: async (req: { method: string; params?: { mapping?: string; key?: string } }) => {
      if (req.method === 'getMappingValue' && req.params?.mapping === 'pool_creators') {
        expect(req.params.key).toBe(POOL_KEY)
        return value
      }
      throw new Error(`unexpected ${req.method}/${req.params?.mapping}`)
    },
  }) as unknown as Client

describe('getPoolCreator', () => {
  it('decodes the creator address', async () => {
    expect(await getPoolCreator(fakeClient(CREATOR), { poolKey: POOL_KEY })).toBe(CREATOR)
  })

  it('returns null when the pool predates creator tracking or does not exist', async () => {
    expect(await getPoolCreator(fakeClient(null), { poolKey: POOL_KEY })).toBeNull()
  })
})
