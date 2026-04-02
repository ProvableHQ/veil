import { describe, it, expect, vi } from 'vitest'
import { mnemonicToAccount } from '../../src/accounts/mnemonicToAccount.js'

describe('mnemonicToAccount', () => {
  it('creates a LocalAccount with source mnemonic', () => {
    const account = mnemonicToAccount({
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      address: 'aleo1abc',
      privateKey: 'APrivateKey1abc',
      viewKey: 'avk1xyz',
    })

    expect(account.type).toBe('local')
    expect(account.source).toBe('mnemonic')
    expect(account.address).toBe('aleo1abc')
    expect(account.privateKey).toBe('APrivateKey1abc')
    expect(account.viewKey).toBe('avk1xyz')
  })

  it('uses provided sign function', async () => {
    const sign = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
    const account = mnemonicToAccount({
      mnemonic: 'test mnemonic',
      address: 'aleo1abc',
      privateKey: 'APrivateKey1abc',
      viewKey: 'avk1xyz',
      sign,
    })

    const result = await account.sign(new Uint8Array([4, 5, 6]))
    expect(result).toEqual(new Uint8Array([1, 2, 3]))
    expect(sign).toHaveBeenCalledWith(new Uint8Array([4, 5, 6]))
  })

  it('throws when sign not provided and called', async () => {
    const account = mnemonicToAccount({
      mnemonic: 'test mnemonic',
      address: 'aleo1abc',
      privateKey: 'APrivateKey1abc',
      viewKey: 'avk1xyz',
    })

    await expect(account.sign(new Uint8Array([1]))).rejects.toThrow('sign() not implemented')
  })
})
