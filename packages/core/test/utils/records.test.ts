import { describe, it, expect } from 'vitest'
import { parseRecordPlaintext, parseRecordPlaintextLoose, toString, encodeInputs } from '../../src/utils/records.js'
import type { RecordDef } from '../../src/types/abi.js'
import type { RecordValue, Plaintext } from '../../src/types/primitives.js'

// ── Test RecordDef ────────────────────────────────────────────────────

const loyaltyCardDef: RecordDef = {
  path: ['LoyaltyCard'],
  fields: [
    { name: 'card_id', type: { kind: 'primitive', primitive: 'field' }, mode: 'private' },
    { name: 'points', type: { kind: 'primitive', primitive: 'u64' }, mode: 'private' },
    { name: 'tier', type: { kind: 'primitive', primitive: 'u8' }, mode: 'private' },
  ],
}

const SAMPLE_PLAINTEXT =
  '{ owner: aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px.private, ' +
  'card_id: 123field.private, ' +
  'points: 1000u64.private, ' +
  'tier: 1u8.private, ' +
  '_nonce: 456group.public }'

// ── parseRecordPlaintext ──────────────────────────────────────────────

describe('parseRecordPlaintext', () => {
  it('parses a record plaintext string with RecordDef', () => {
    const record = parseRecordPlaintext(SAMPLE_PLAINTEXT, loyaltyCardDef, 'loyalty_token.aleo')

    expect(record.owner).toBe('aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px')
    expect(record.program).toBe('loyalty_token.aleo')
    expect(record.recordName).toBe('LoyaltyCard')
    expect(record.nonce).toBe('456group')

    expect(record.fields.card_id.value).toBe(123n)
    expect(record.fields.card_id.mode).toBe('private')
    expect(record.fields.card_id.type).toEqual({ kind: 'primitive', primitive: 'field' })

    expect(record.fields.points.value).toBe(1000n)
    expect(record.fields.points.mode).toBe('private')
    expect(record.fields.points.type).toEqual({ kind: 'primitive', primitive: 'u64' })

    expect(record.fields.tier.value).toBe(1n)
    expect(record.fields.tier.mode).toBe('private')
    expect(record.fields.tier.type).toEqual({ kind: 'primitive', primitive: 'u8' })
  })

  it('skips internal fields (_nonce, _version)', () => {
    const record = parseRecordPlaintext(SAMPLE_PLAINTEXT, loyaltyCardDef, 'loyalty_token.aleo')
    expect(record.fields['_nonce']).toBeUndefined()
  })

  it('extracts owner without visibility suffix', () => {
    const record = parseRecordPlaintext(SAMPLE_PLAINTEXT, loyaltyCardDef, 'loyalty_token.aleo')
    expect(record.owner).not.toContain('.private')
  })
})

// ── parseRecordPlaintextLoose ─────────────────────────────────────────

describe('parseRecordPlaintextLoose', () => {
  it('parses without RecordDef by inferring types from values', () => {
    const record = parseRecordPlaintextLoose(SAMPLE_PLAINTEXT)

    expect(record.fields.points.value).toBe(1000n)
    expect(record.fields.points.type).toEqual({ kind: 'primitive', primitive: 'u64' })

    expect(record.fields.tier.value).toBe(1n)
    expect(record.fields.tier.type).toEqual({ kind: 'primitive', primitive: 'u8' })
  })
})

// ── toString ───────────────────────────────────────────────────────

describe('toString', () => {
  it('serializes a RecordValue back to plaintext format', () => {
    const record: RecordValue = {
      owner: 'aleo1abc',
      program: 'test.aleo',
      recordName: 'TestRecord',
      fields: {
        points: { value: 1000n, mode: 'private', type: { kind: 'primitive', primitive: 'u64' } },
        tier: { value: 2n, mode: 'private', type: { kind: 'primitive', primitive: 'u8' } },
      },
      nonce: '789group',
    }

    const result = toString(record)

    expect(result).toContain('owner: aleo1abc.private')
    expect(result).toContain('points: 1000u64.private')
    expect(result).toContain('tier: 2u8.private')
    expect(result).toContain('_nonce: 789group.public')
  })

  it('round-trips: parseRecordPlaintext → toString produces equivalent output', () => {
    const parsed = parseRecordPlaintext(SAMPLE_PLAINTEXT, loyaltyCardDef, 'loyalty_token.aleo')
    const serialized = toString(parsed)

    expect(serialized).toContain('owner: aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px.private')
    expect(serialized).toContain('card_id: 123field.private')
    expect(serialized).toContain('points: 1000u64.private')
    expect(serialized).toContain('tier: 1u8.private')
    expect(serialized).toContain('_nonce: 456group.public')
  })
})

// ── RecordFieldValue.type necessity ───────────────────────────────────

describe('RecordFieldValue.type proves necessary for serialization', () => {
  it('cannot determine Aleo type from bigint alone', () => {
    // All of these are valid Aleo types for the value 1000n:
    const asU64 = 1000n
    const asU128 = 1000n
    const asField = 1000n
    const asI64 = 1000n

    // At runtime, they are identical
    expect(asU64).toBe(asU128)
    expect(asU128).toBe(asField)
    expect(asField).toBe(asI64)
    expect(typeof asU64).toBe('bigint')
    expect(typeof asU128).toBe('bigint')
    expect(typeof asField).toBe('bigint')
    expect(typeof asI64).toBe('bigint')

    // But they serialize differently:
    // "1000u64" vs "1000u128" vs "1000field" vs "1000i64"
    // Without `type: Plaintext`, there's no way to know which suffix to use
  })

  it('with type: Plaintext, serialization is unambiguous', () => {
    const fieldU64: RecordValue['fields'][string] = {
      value: 1000n,
      mode: 'private',
      type: { kind: 'primitive', primitive: 'u64' },
    }

    const fieldU128: RecordValue['fields'][string] = {
      value: 1000n,
      mode: 'private',
      type: { kind: 'primitive', primitive: 'u128' },
    }

    const fieldField: RecordValue['fields'][string] = {
      value: 1000n,
      mode: 'private',
      type: { kind: 'primitive', primitive: 'field' },
    }

    // Same runtime value, but toString produces different results
    const recordU64: RecordValue = { owner: 'aleo1x', program: 'test.aleo', recordName: 'Test', fields: { val: fieldU64 }, nonce: '0group' }
    const recordU128: RecordValue = { owner: 'aleo1x', program: 'test.aleo', recordName: 'Test', fields: { val: fieldU128 }, nonce: '0group' }
    const recordField: RecordValue = { owner: 'aleo1x', program: 'test.aleo', recordName: 'Test', fields: { val: fieldField }, nonce: '0group' }

    expect(toString(recordU64)).toContain('val: 1000u64.private')
    expect(toString(recordU128)).toContain('val: 1000u128.private')
    expect(toString(recordField)).toContain('val: 1000field.private')
  })
})

// ── encodeInputs ──────────────────────────────────────────────────────

describe('encodeInputs', () => {
  const inputTypes: Plaintext[] = [
    { kind: 'primitive', primitive: 'address' },
    { kind: 'primitive', primitive: 'u64' },
    { kind: 'primitive', primitive: 'field' },
  ]

  it('encodes native JS values using ABI types', () => {
    const encoded = encodeInputs(['aleo1abc', 1000n, 42n], inputTypes)

    expect(encoded[0]).toBe('aleo1abc')
    expect(encoded[1]).toBe('1000u64')
    expect(encoded[2]).toBe('42field')
  })

  it('passes through pre-encoded strings', () => {
    const encoded = encodeInputs(['1000u64', '42field'], inputTypes)

    expect(encoded[0]).toBe('1000u64')
    expect(encoded[1]).toBe('42field')
  })

  it('encodes booleans', () => {
    const boolTypes: Plaintext[] = [{ kind: 'primitive', primitive: 'boolean' }]
    const encoded = encodeInputs([true], boolTypes)

    expect(encoded[0]).toBe('true')
  })

  it('encodes numbers as bigint with type suffix', () => {
    const encoded = encodeInputs([42, 100], [
      { kind: 'primitive', primitive: 'u8' },
      { kind: 'primitive', primitive: 'u64' },
    ])

    expect(encoded[0]).toBe('42u8')
    expect(encoded[1]).toBe('100u64')
  })

  it('serializes RecordValue inputs via toString', () => {
    const record: RecordValue = {
      owner: 'aleo1abc',
      program: 'test.aleo',
      recordName: 'Test',
      fields: {
        points: { value: 500n, mode: 'private', type: { kind: 'primitive', primitive: 'u64' } },
      },
      nonce: '0group',
    }

    const encoded = encodeInputs([record], [{ kind: 'primitive', primitive: 'u64' }])

    expect(encoded[0]).toContain('owner: aleo1abc.private')
    expect(encoded[0]).toContain('points: 500u64.private')
  })
})
