import { describe, it, expect, vi } from 'vitest'
import { createPublicClient } from '../../src/clients/createPublicClient.js'
import { custom } from '../../src/transports/custom.js'

describe('createPublicClient', () => {
  it('creates a public client with public actions', () => {
    const transport = custom({ request: vi.fn() })
    const client = createPublicClient({ transport })

    expect(client.key).toBe('public')
    expect(client.name).toBe('Public Client')
    expect(client.getBlockNumber).toBeTypeOf('function')
    expect(client.getBlock).toBeTypeOf('function')
    expect(client.getBalance).toBeTypeOf('function')
    expect(client.getTransaction).toBeTypeOf('function')
    expect(client.readContract).toBeTypeOf('function')
    expect(client.getCode).toBeTypeOf('function')
  })
})
