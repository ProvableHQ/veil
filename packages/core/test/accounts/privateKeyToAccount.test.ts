import { describe, it, expect } from 'vitest'
import { privateKeyToAccount } from '../../src/accounts/privateKeyToAccount.js'

describe('privateKeyToAccount', () => {
  it('creates a LocalAccount with type local and source privateKey', () => {
    const account = privateKeyToAccount({
      privateKey: 'APrivateKey1zkpFakeKeyForTesting123456789abcdef',
      address: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      viewKey: 'AViewKey1fakeViewKeyForTesting123456789',
    })

    expect(account.type).toBe('local')
    expect(account.source).toBe('privateKey')
    expect(account.privateKey).toBe('APrivateKey1zkpFakeKeyForTesting123456789abcdef')
    expect(account.address).toBe('aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')
    expect(account.viewKey).toBe('AViewKey1fakeViewKeyForTesting123456789')
    expect(account.sign).toBeTypeOf('function')
    expect(account.signMessage).toBeTypeOf('function')
  })
})
