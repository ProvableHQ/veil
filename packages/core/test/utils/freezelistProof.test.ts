import { describe, expect, it } from 'vitest'
import * as core from '../../src/index.js'

describe('freezelist proof requests', () => {
  it('builds a signer request without disclosing an address', () => {
    expect(core.freezelistProofRequest({ freezelistProgram: 'compliance.aleo' })).toEqual({
      type: 'derived',
      algorithm: 'program-freezelist-exclusion-proof',
      args: { freezelistProgram: { type: 'string', value: 'compliance.aleo' } },
    })
  })

  it('encodes an explicit subject and display label', () => {
    expect(core.freezelistProofRequest({ freezelistProgram: 'compliance.aleo', address: 'aleo1recipient', label: 'Recipient proof' })).toEqual({
      type: 'derived',
      algorithm: 'program-freezelist-exclusion-proof',
      args: {
        freezelistProgram: { type: 'string', value: 'compliance.aleo' },
        address: { type: 'address', value: 'aleo1recipient' },
      },
      label: 'Recipient proof',
    })
  })

  it('constrains a grant to the intended freezelist and input slot', () => {
    expect(core.freezelistProofGrant({ program: 'token.aleo', function: 'transfer_private', inputPosition: 3, freezelistProgram: 'compliance.aleo' })).toEqual({
      algorithm: 'program-freezelist-exclusion-proof',
      program: 'token.aleo',
      function: 'transfer_private',
      inputPosition: 3,
      argConstraints: { freezelistProgram: ['compliance.aleo'] },
    })
  })

  it('recognizes the exact proof shape and rejects malformed or unrelated requests', () => {
    const request = { type: 'derived', algorithm: 'program-freezelist-exclusion-proof', args: { freezelistProgram: { type: 'string', value: 'compliance.aleo' } } }
    expect(core.isFreezelistProofRequest(request)).toBe(true)
    expect(core.isFreezelistProofRequest({ ...request, args: { ...request.args, address: { type: 'address', value: 'aleo1recipient' } } })).toBe(true)
    for (const invalid of [null, '[]', {}, { type: 'address' }, { ...request, algorithm: 'other' }, { ...request, args: {} }, { ...request, args: { freezelistProgram: { type: 'address', value: 'compliance.aleo' } } }, { ...request, args: { ...request.args, address: { type: 'string', value: 'aleo1recipient' } } }, { ...request, args: { ...request.args, address: null } }, { ...request, label: 1 }]) {
      expect(core.isFreezelistProofRequest(invalid)).toBe(false)
    }
  })
})
