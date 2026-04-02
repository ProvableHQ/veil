import { describe, it, expect, vi } from 'vitest'
import { createWalletClient } from '../../src/clients/createWalletClient.js'
import { custom } from '../../src/transports/custom.js'

describe('createWalletClient', () => {
  it('creates a wallet client with wallet actions', () => {
    const transport = custom({ request: vi.fn() })
    const mockAccount = { type: 'rpc' as const, address: 'aleo1abc', sign: vi.fn(), signMessage: vi.fn() }
    const client = createWalletClient({ account: mockAccount, transport })

    expect(client.key).toBe('wallet')
    expect(client.name).toBe('Wallet Client')
    expect(client.sendTransaction).toBeTypeOf('function')
    expect(client.writeContract).toBeTypeOf('function')
    expect(client.executeTransaction).toBeTypeOf('function')
    expect(client.deployContract).toBeTypeOf('function')
    expect(client.signMessage).toBeTypeOf('function')
    expect(client.transfer).toBeTypeOf('function')
  })

  it('executeTransaction is an alias for writeContract', () => {
    const transport = custom({ request: vi.fn() })
    const mockAccount = { type: 'rpc' as const, address: 'aleo1abc', sign: vi.fn(), signMessage: vi.fn() }
    const client = createWalletClient({ account: mockAccount, transport })

    expect(client.executeTransaction).toBeTypeOf('function')
    expect(client.writeContract).toBeTypeOf('function')
  })
})
