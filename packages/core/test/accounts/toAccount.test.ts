import { describe, it, expect, vi } from 'vitest'
import { toAccount } from '../../src/accounts/toAccount.js'

describe('toAccount', () => {
  it('creates an RPC account', () => {
    const account = toAccount({ type: 'rpc', address: 'aleo1abc' })
    expect(account.type).toBe('rpc')
    expect(account.address).toBe('aleo1abc')
  })

  it('creates a viewOnly account', () => {
    const account = toAccount({ type: 'viewOnly', address: 'aleo1abc', viewKey: 'avk1xyz' })
    expect(account.type).toBe('viewOnly')
    expect(account.address).toBe('aleo1abc')
    expect(account.viewKey).toBe('avk1xyz')
  })

  it('creates a local account', () => {
    const sign = vi.fn()
    const account = toAccount({
      type: 'local',
      address: 'aleo1abc',
      privateKey: 'APrivateKey1abc',
      viewKey: 'avk1xyz',
      source: 'privateKey',
      sign,
    })
    expect(account.type).toBe('local')
    expect(account.address).toBe('aleo1abc')
    expect(account.privateKey).toBe('APrivateKey1abc')
    expect(account.viewKey).toBe('avk1xyz')
  })
})
