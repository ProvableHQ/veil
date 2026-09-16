import { describe, expect, it, vi } from 'vitest'
import { createAleoClient, aleoWallet } from '../../src/connections/aleo.js'

describe('Aleo bridge clients', () => {
  it('constructs tagged public and wallet capabilities without calling them', () => {
    const executeTransaction = vi.fn()
    const publicClient = { request: vi.fn() } as never
    const account = aleoWallet({ executeTransaction })
    const client = createAleoClient({ publicClient, account })

    expect(client).toEqual({ family: 'aleo', publicClient, walletClient: account })
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('requires public access even when a wallet account is supplied', () => {
    expect(() => createAleoClient({} as never)).toThrow('Aleo client requires a public client')
    expect(() => createAleoClient({ account: { executeTransaction: async () => 'tx' } } as never)).toThrow(
      'Aleo client requires a public client',
    )
  })
})
