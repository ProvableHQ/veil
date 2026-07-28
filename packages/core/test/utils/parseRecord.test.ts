import { describe, it, expect } from 'vitest'
import { parseRecord, serializeRecord } from '../../src/utils/records.js'
import type { RecordDef } from '../../src/types/abi.js'

const OWNER = 'aleo1rhgdu77hgyqd3xjcrf64wgs7wyehnhvw2rgvfgu6yheugf5fs5zsxwwm5h'

const basic = `{
  owner: ${OWNER}.private,
  points: 1000u64.private,
  tier: 3u8.public,
  _nonce: 123group.public
}`

describe('parseRecord', () => {
  it('parses entries with values, modes, and suffix-inferred types', () => {
    const record = parseRecord(basic, { program: 'loyalty_token.aleo', recordName: 'LoyaltyCard' })
    expect(record.owner).toBe(OWNER)
    expect(record.ownerVisibility).toBe('private')
    expect(record.nonce).toBe('123group')
    expect(record.program).toBe('loyalty_token.aleo')
    expect(record.fields.points).toEqual({
      value: 1000n,
      mode: 'private',
      type: { kind: 'primitive', primitive: 'u64' },
    })
    expect(record.fields.tier?.mode).toBe('public')
  })

  it('defaults version to 0 when _version is absent', () => {
    expect(parseRecord(basic).version).toBe(0)
  })

  it('captures _version instead of dropping it', () => {
    const record = parseRecord(`{
  owner: ${OWNER}.private,
  points: 1000u64.private,
  _nonce: 123group.public,
  _version: 1u8.public
}`)
    expect(record.version).toBe(1)
    expect(record.fields).not.toHaveProperty('_version')
  })

  it('strips a public owner suffix and records ownerVisibility', () => {
    const record = parseRecord(`{
  owner: ${OWNER}.public,
  points: 1000u64.private,
  _nonce: 123group.public
}`)
    expect(record.owner).toBe(OWNER)
    expect(record.ownerVisibility).toBe('public')
  })

  it('parses constant entries with their own mode', () => {
    const record = parseRecord(`{
  owner: ${OWNER}.private,
  limit: 5u8.constant,
  _nonce: 123group.public
}`)
    expect(record.fields.limit?.mode).toBe('constant')
    expect(record.fields.limit?.value).toBe(5n)
  })

  it('strips leaf visibility suffixes inside composite entries', () => {
    const record = parseRecord(`{
  owner: ${OWNER}.private,
  data: {
    first: 10i64.private,
    second: 198u64.private
  },
  _nonce: 123group.public
}`)
    expect(record.fields.data?.value).toEqual({ first: 10n, second: 198n })
    expect(record.fields.data?.mode).toBe('private')
  })

  it('throws on struct plaintext (no owner/_nonce)', () => {
    expect(() => parseRecord('{ token0: 11field, fee: 3000u32 }')).toThrow(/parsePlaintextValue/)
  })

  it('hoists metadata out of fields (owner, _nonce, _version)', () => {
    const record = parseRecord(`{
  owner: ${OWNER}.private,
  points: 1000u64.private,
  _nonce: 123group.public,
  _version: 1u8.public
}`)
    expect(record.fields['owner']).toBeUndefined()
    expect(record.fields['_nonce']).toBeUndefined()
    expect(record.fields['_version']).toBeUndefined()
  })

  it('enriches type descriptors from an optional RecordDef', () => {
    const def: RecordDef = {
      path: ['LoyaltyCard'],
      fields: [
        { name: 'points', type: { kind: 'primitive', primitive: 'u64' }, mode: 'private' },
        { name: 'tier', type: { kind: 'primitive', primitive: 'u8' }, mode: 'public' },
      ],
    }
    const record = parseRecord(basic, { def })
    expect(record.recordName).toBe('LoyaltyCard')
    expect(record.fields.tier?.type).toEqual({ kind: 'primitive', primitive: 'u8' })
  })

  it('round-trips through serializeRecord byte-for-byte', () => {
    const text = `{
  owner: ${OWNER}.public,
  points: 1000u64.private,
  _nonce: 123group.public,
  _version: 1u8.public
}`
    const record = parseRecord(text)
    expect(serializeRecord(record)).toBe(text)
    expect(parseRecord(serializeRecord(record))).toEqual(record)
  })
})

describe('serializeRecord without raw text', () => {
  it('synthesizes plaintext honoring ownerVisibility, entry modes, and version', () => {
    const record = parseRecord(basic)
    const synthesized = serializeRecord({ ...record, raw: undefined })
    const reparsed = parseRecord(synthesized)
    expect(reparsed.owner).toBe(OWNER)
    expect(reparsed.ownerVisibility).toBe('private')
    expect(reparsed.version).toBe(0)
    expect(reparsed.fields.points?.value).toBe(1000n)
    expect(reparsed.fields.tier?.mode).toBe('public')
  })
})
