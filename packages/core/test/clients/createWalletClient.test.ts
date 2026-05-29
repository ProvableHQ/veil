import { describe, it, expect, vi } from 'vitest'
import { createWalletClient } from '../../src/clients/createWalletClient.js'
import { custom } from '../../src/transports/custom.js'
import * as veilCore from '../../src/index.js'

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
    expect(client.executeContract).toBeTypeOf('function')
    expect(client.deployContract).toBeTypeOf('function')
    expect(client.signMessage).toBeTypeOf('function')
    expect(client.transfer).toBeTypeOf('function')
  })

  it('executeTransaction and writeContract produce identical requests', async () => {
    const request = vi.fn().mockResolvedValue('at1tx_identical')
    const transport = custom({ request })
    const mockAccount = { type: 'rpc' as const, address: 'aleo1abc', sign: vi.fn(), signMessage: vi.fn() }
    const client = createWalletClient({ account: mockAccount, transport })

    const params = {
      program: 'token.aleo',
      function: 'transfer',
      inputs: ['aleo1recipient', '100u64'],
      privateFee: false,
    }

    const writeResult = await client.writeContract(params)
    const writeCall = request.mock.calls.at(-1)
    request.mockClear()

    const execResult = await client.executeTransaction(params)
    const execCall = request.mock.calls.at(-1)

    // Both call sites should produce byte-identical RPC requests and returns.
    expect(execCall).toEqual(writeCall)
    expect(execResult).toBe(writeResult)
    expect(execResult).toBe('at1tx_identical')
  })

  it('top-level executeTransaction export === writeContract', () => {
    // Public API guarantee: the package-level `executeTransaction` resolves to the
    // light `writeContract`, matching the Aleo wallet adapter spec semantics.
    expect(veilCore.executeTransaction).toBe(veilCore.writeContract)
    // And the heavy lifecycle action is exported under its own name, distinct from writeContract.
    expect(veilCore.executeContract).not.toBe(veilCore.writeContract)
  })
})
