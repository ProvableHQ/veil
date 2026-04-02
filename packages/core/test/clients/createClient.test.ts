import { describe, it, expect, vi } from 'vitest'
import { createClient } from '../../src/clients/createClient.js'
import { custom } from '../../src/transports/custom.js'

describe('createClient', () => {
  it('creates a client with transport', () => {
    const transport = custom({ request: vi.fn() })
    const client = createClient({ transport })

    expect(client.transport).toBe(transport)
    expect(client.uid).toBeDefined()
    expect(client.request).toBeTypeOf('function')
  })

  it('stores account if provided', () => {
    const transport = custom({ request: vi.fn() })
    const mockAccount = { type: 'rpc' as const, address: 'aleo1abc', sign: vi.fn(), signMessage: vi.fn() }
    const client = createClient({ transport, account: mockAccount })

    expect(client.account).toBe(mockAccount)
  })

  it('stores proving and records config if provided', () => {
    const transport = custom({ request: vi.fn() })
    const proving = { mode: 'delegated' as const, url: 'https://prover.example.com' }
    const records = { mode: 'network' as const, url: 'https://records.example.com' }
    const client = createClient({ transport, proving, records })

    expect(client.proving).toBe(proving)
    expect(client.records).toBe(records)
  })

  it('extends client with additional actions', () => {
    const transport = custom({ request: vi.fn() })
    const client = createClient({ transport })
    const extended = client.extend((_base) => ({
      doStuff: () => 'done',
    }))

    expect(extended.doStuff()).toBe('done')
    expect(extended.transport).toBe(transport)
  })
})
