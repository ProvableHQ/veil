import { describe, expect, it } from 'vitest'
import { isInputRequest, assertNoInputRequests, type TransactionInput } from '../../src/types/inputRequest.js'

describe('isInputRequest', () => {
  it('returns false for literal string inputs', () => {
    expect(isInputRequest('100u64')).toBe(false)
    expect(isInputRequest('aleo1abc')).toBe(false)
  })

  it('returns true for address/record/derived requests', () => {
    expect(isInputRequest({ type: 'address' })).toBe(true)
    expect(isInputRequest({ type: 'record', program: 'credits.aleo', recordname: 'credits', uid: 'u1' })).toBe(true)
    expect(isInputRequest({ type: 'derived', algorithm: 'program-scoped-blinding-factor', args: {} })).toBe(true)
  })
})

describe('assertNoInputRequests', () => {
  it('passes for all-string inputs', () => {
    const inputs: TransactionInput[] = ['100u64', 'aleo1abc']
    expect(() => assertNoInputRequests(inputs)).not.toThrow()
  })

  it('throws when any input is a request', () => {
    const inputs: TransactionInput[] = ['100u64', { type: 'address' }]
    expect(() => assertNoInputRequests(inputs)).toThrow(/require a wallet account/)
  })
})
