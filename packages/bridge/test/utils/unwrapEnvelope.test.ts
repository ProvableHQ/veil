import { describe, it, expect } from 'vitest'
import { unwrapEnvelope } from '../../src/utils/unwrapEnvelope.js'
import { BridgeEnvelopeError } from '../../src/errors/bridgeErrors.js'

describe('unwrapEnvelope', () => {
  it('returns data when keepMeta is false', () => {
    const response = { data: { id: '1' }, meta: { count: 1 } }
    const result = unwrapEnvelope(response, { keepMeta: false })
    expect(result).toEqual({ id: '1' })
  })

  it('returns data and meta when keepMeta is true', () => {
    const response = { data: { id: '1' }, meta: { count: 1 } }
    const result = unwrapEnvelope(response, { keepMeta: true })
    expect(result).toEqual({ data: { id: '1' }, meta: { count: 1 } })
  })

  it('returns data and empty meta when keepMeta is true but meta missing', () => {
    const response = { data: { id: '1' } }
    const result = unwrapEnvelope(response, { keepMeta: true })
    expect(result).toEqual({ data: { id: '1' }, meta: {} })
  })

  it('throws BridgeEnvelopeError when data is absent', () => {
    expect(() => unwrapEnvelope({ meta: {} } as any, { keepMeta: false }))
      .toThrowError(BridgeEnvelopeError)
  })

  it('throws BridgeEnvelopeError when response is null', () => {
    expect(() => unwrapEnvelope(null as any, { keepMeta: false }))
      .toThrowError(BridgeEnvelopeError)
  })
})
