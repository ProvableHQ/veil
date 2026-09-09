import { describe, expect, it, vi } from 'vitest'
import { aleoConnection, aleoWallet, materializeAleoConnection } from '../../src/connections/aleo.js'

describe('Aleo bridge connections', () => {
  it('constructs tagged public and wallet capabilities without calling them', () => {
    const executeTransaction = vi.fn()
    const publicClient = { request: vi.fn() } as never
    const definition = aleoConnection({ publicClient, account: aleoWallet({ executeTransaction }) })
    const connection = materializeAleoConnection(definition)

    expect(connection).toEqual({ family: 'aleo', publicClient, walletClient: definition.account })
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('requires public access even when a wallet account is supplied', () => {
    expect(() => aleoConnection({} as never)).toThrow('Aleo connection requires a public client')
    expect(() => aleoConnection({ account: { executeTransaction: async () => 'tx' } } as never)).toThrow(
      'Aleo connection requires a public client',
    )
  })
})
