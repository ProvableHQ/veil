import { describe, it, expectTypeOf } from 'vitest'
import type {
  Account,
  SignerAccount,
  LocalAccount,
  RpcAccount,
  ViewOnlyAccount,
} from '../../src/types/account.js'

describe('Account types', () => {
  it('Account has address only, no viewKey', () => {
    expectTypeOf<Account>().toHaveProperty('address')
    expectTypeOf<Account['address']>().toBeString()
  })

  it('SignerAccount extends Account with sign methods', () => {
    expectTypeOf<SignerAccount>().toHaveProperty('address')
    expectTypeOf<SignerAccount>().toHaveProperty('sign')
    expectTypeOf<SignerAccount>().toHaveProperty('signMessage')
  })

  it('LocalAccount has type local, privateKey, and viewKey', () => {
    expectTypeOf<LocalAccount['type']>().toEqualTypeOf<'local'>()
    expectTypeOf<LocalAccount>().toHaveProperty('privateKey')
    expectTypeOf<LocalAccount>().toHaveProperty('viewKey')
    expectTypeOf<LocalAccount['viewKey']>().toBeString()
    expectTypeOf<LocalAccount>().toHaveProperty('sign')
    expectTypeOf<LocalAccount>().toHaveProperty('signMessage')
  })

  it('RpcAccount has type rpc and sign methods', () => {
    expectTypeOf<RpcAccount['type']>().toEqualTypeOf<'rpc'>()
    expectTypeOf<RpcAccount>().toHaveProperty('sign')
    expectTypeOf<RpcAccount>().toHaveProperty('signMessage')
  })

  it('ViewOnlyAccount has type viewOnly and required viewKey', () => {
    expectTypeOf<ViewOnlyAccount['type']>().toEqualTypeOf<'viewOnly'>()
    expectTypeOf<ViewOnlyAccount['viewKey']>().toBeString()
  })
})
