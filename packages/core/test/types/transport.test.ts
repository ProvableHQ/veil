import { describe, it, expectTypeOf } from 'vitest'
import type { TransportConfig, RequestFn } from '../../src/types/transport.js'

describe('Transport types', () => {
  it('TransportConfig has required fields', () => {
    expectTypeOf<TransportConfig>().toHaveProperty('key')
    expectTypeOf<TransportConfig>().toHaveProperty('name')
    expectTypeOf<TransportConfig>().toHaveProperty('request')
    expectTypeOf<TransportConfig>().toHaveProperty('type')
  })

  it('RequestFn takes method and params', () => {
    expectTypeOf<RequestFn>().toBeFunction()
    expectTypeOf<RequestFn>().parameter(0).toHaveProperty('method')
  })
})
