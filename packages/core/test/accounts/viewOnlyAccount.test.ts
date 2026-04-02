import { describe, it, expect } from 'vitest'
import { viewOnlyAccount } from '../../src/accounts/viewOnlyAccount.js'

describe('viewOnlyAccount', () => {
  it('creates a ViewOnlyAccount', () => {
    const account = viewOnlyAccount({
      address: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      viewKey: 'AViewKey1fakeViewKeyForTesting123456789',
    })

    expect(account.type).toBe('viewOnly')
    expect(account.viewKey).toBe('AViewKey1fakeViewKeyForTesting123456789')
    expect(account).not.toHaveProperty('sign')
  })
})
