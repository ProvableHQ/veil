import { describe, it, expect } from 'vitest'
import {
  applyRecordFilter,
  resolveScanPrograms,
  assertValidRecordFilter,
  DEFAULT_RECORD_PAGE_SIZE,
} from '../../src/utils/recordFilter.js'
import type { OwnedRecordEncrypted } from '../../src/types/records.js'

// Minimal record factory — programName and tag are the two required fields.
function record(fields: Partial<OwnedRecordEncrypted> = {}): OwnedRecordEncrypted {
  return { programName: 'token.aleo', tag: 'tag1', ...fields }
}

describe('resolveScanPrograms', () => {
  it('returns undefined when neither program nor filter.programs is set', () => {
    expect(resolveScanPrograms({})).toBeUndefined()
    expect(resolveScanPrograms({ filter: {} })).toBeUndefined()
  })

  it('wraps a bare program', () => {
    expect(resolveScanPrograms({ program: 'token.aleo' })).toEqual(['token.aleo'])
  })

  it('unions program with filter.programs', () => {
    expect(
      resolveScanPrograms({ program: 'a.aleo', filter: { programs: ['b.aleo'] } }),
    ).toEqual(['a.aleo', 'b.aleo'])
  })

  it('deduplicates an overlap rather than repeating it', () => {
    expect(
      resolveScanPrograms({ program: 'a.aleo', filter: { programs: ['a.aleo', 'b.aleo'] } }),
    ).toEqual(['a.aleo', 'b.aleo'])
  })
})

describe('assertValidRecordFilter', () => {
  it('accepts an absent filter and one without pagination', () => {
    expect(() => assertValidRecordFilter(undefined)).not.toThrow()
    expect(() => assertValidRecordFilter({})).not.toThrow()
    expect(() => assertValidRecordFilter({ records: ['A'] })).not.toThrow()
  })

  it('accepts the boundary values', () => {
    expect(() => assertValidRecordFilter({ resultsPerPage: 1, page: 0 })).not.toThrow()
  })

  it('rejects a non-positive or fractional resultsPerPage', () => {
    for (const resultsPerPage of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertValidRecordFilter({ resultsPerPage })).toThrow(
        /resultsPerPage must be a positive integer/,
      )
    }
  })

  it('rejects a negative or fractional page', () => {
    for (const page of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertValidRecordFilter({ page })).toThrow(
        /page must be a non-negative integer/,
      )
    }
  })

  it('names the offending value in the message', () => {
    expect(() => assertValidRecordFilter({ page: -7 })).toThrow(/received -7/)
  })
})

describe('applyRecordFilter', () => {
  it('returns the input untouched when no filter is given', () => {
    const records = [record({ commitment: 'c2' }), record({ commitment: 'c1' })]
    const result = applyRecordFilter(records, { program: 'token.aleo' })
    // Same reference: an unfiltered call must not reorder or copy.
    expect(result).toBe(records)
    expect(result.map((r) => r.commitment)).toEqual(['c2', 'c1'])
  })

  it('filters by record name', () => {
    const records = [
      record({ recordName: 'Position', commitment: 'c1' }),
      record({ recordName: 'Fee', commitment: 'c2' }),
    ]
    const result = applyRecordFilter(records, { filter: { records: ['Position'] } })
    expect(result.map((r) => r.commitment)).toEqual(['c1'])
  })

  it('treats multiple values in one field as OR', () => {
    const records = [
      record({ recordName: 'Position', commitment: 'c1' }),
      record({ recordName: 'Fee', commitment: 'c2' }),
      record({ recordName: 'Other', commitment: 'c3' }),
    ]
    const result = applyRecordFilter(records, { filter: { records: ['Position', 'Fee'] } })
    expect(result.map((r) => r.commitment)).toEqual(['c1', 'c2'])
  })

  it('treats separate fields as AND', () => {
    const records = [
      record({ recordName: 'Position', functionName: 'mint', commitment: 'c1' }),
      record({ recordName: 'Position', functionName: 'burn', commitment: 'c2' }),
    ]
    const result = applyRecordFilter(records, {
      filter: { records: ['Position'], functions: ['mint'] },
    })
    expect(result.map((r) => r.commitment)).toEqual(['c1'])
  })

  it('filters by program, unioning the top-level program', () => {
    const records = [
      record({ programName: 'a.aleo', commitment: 'c1' }),
      record({ programName: 'b.aleo', commitment: 'c2' }),
      record({ programName: 'c.aleo', commitment: 'c3' }),
    ]
    const result = applyRecordFilter(records, {
      program: 'a.aleo',
      filter: { programs: ['b.aleo'] },
    })
    expect(result.map((r) => r.commitment)).toEqual(['c1', 'c2'])
  })

  it('filters by commitment', () => {
    const records = [record({ commitment: 'c1' }), record({ commitment: 'c2' })]
    const result = applyRecordFilter(records, { filter: { commitments: ['c2'] } })
    expect(result.map((r) => r.commitment)).toEqual(['c2'])
  })

  it('applies start and end as an inclusive block range', () => {
    const records = [
      record({ blockHeight: 99, commitment: 'c1' }),
      record({ blockHeight: 100, commitment: 'c2' }),
      record({ blockHeight: 150, commitment: 'c3' }),
      record({ blockHeight: 200, commitment: 'c4' }),
      record({ blockHeight: 201, commitment: 'c5' }),
    ]
    const result = applyRecordFilter(records, { filter: { start: 100, end: 200 } })
    expect(result.map((r) => r.commitment)).toEqual(['c2', 'c3', 'c4'])
  })

  it('excludes a record with no block height when a range bound is set', () => {
    // A bound cannot be evaluated against an absent height, so the record is
    // excluded rather than read as height 0.
    const records = [record({ commitment: 'c1' }), record({ blockHeight: 5, commitment: 'c2' })]
    expect(applyRecordFilter(records, { filter: { start: 1 } }).map((r) => r.commitment)).toEqual(['c2'])
    expect(applyRecordFilter(records, { filter: { end: 10 } }).map((r) => r.commitment)).toEqual(['c2'])
  })

  it('excludes a record missing the field a bound tests', () => {
    const records = [record({ commitment: 'c1' })]
    expect(applyRecordFilter(records, { filter: { records: ['Position'] } })).toEqual([])
    expect(applyRecordFilter(records, { filter: { functions: ['mint'] } })).toEqual([])
    expect(applyRecordFilter([record()], { filter: { commitments: ['c1'] } })).toEqual([])
  })

  it('orders by block height then commitment', () => {
    const records = [
      record({ blockHeight: 2, commitment: 'b' }),
      record({ blockHeight: 1, commitment: 'z' }),
      record({ blockHeight: 2, commitment: 'a' }),
      record({ blockHeight: 1, commitment: 'y' }),
    ]
    const result = applyRecordFilter(records, { filter: {} })
    expect(result.map((r) => [r.blockHeight, r.commitment])).toEqual([
      [1, 'y'],
      [1, 'z'],
      [2, 'a'],
      [2, 'b'],
    ])
  })

  it('sorts records with no block height last', () => {
    const records = [record({ commitment: 'no-height' }), record({ blockHeight: 5, commitment: 'c1' })]
    const result = applyRecordFilter(records, { filter: {} })
    expect(result.map((r) => r.commitment)).toEqual(['c1', 'no-height'])
  })

  it('sorts a record with no commitment after one that has it, at the same height', () => {
    // An absent commitment must not sort first the way an empty string would —
    // both sort keys treat a missing field the same way, which is what keeps a
    // page index stable when some records omit the field.
    const records = [
      record({ blockHeight: 1, commitment: undefined, tag: 'no-commitment' }),
      record({ blockHeight: 1, commitment: 'aaa', tag: 'has-commitment' }),
    ]
    const result = applyRecordFilter(records, { filter: {} })
    expect(result.map((r) => r.tag)).toEqual(['has-commitment', 'no-commitment'])
  })

  describe('empty arrays apply no bound', () => {
    // A list assembled at runtime that comes back empty must widen the scan, not
    // silently empty it. programs already behaved this way; the rest now match.
    const records = [
      record({ recordName: 'Position', functionName: 'mint', commitment: 'c1' }),
      record({ recordName: 'Fee', functionName: 'burn', commitment: 'c2' }),
    ]

    it('ignores an empty commitments array', () => {
      const result = applyRecordFilter(records, { filter: { commitments: [] } })
      expect(result.map((r) => r.commitment)).toEqual(['c1', 'c2'])
    })

    it('ignores an empty records array', () => {
      const result = applyRecordFilter(records, { filter: { records: [] } })
      expect(result.map((r) => r.commitment)).toEqual(['c1', 'c2'])
    })

    it('ignores an empty functions array', () => {
      const result = applyRecordFilter(records, { filter: { functions: [] } })
      expect(result.map((r) => r.commitment)).toEqual(['c1', 'c2'])
    })

    it('ignores an empty programs array, keeping the top-level program bound', () => {
      const mixed = [
        record({ programName: 'a.aleo', commitment: 'c1' }),
        record({ programName: 'b.aleo', commitment: 'c2' }),
      ]
      const result = applyRecordFilter(mixed, { program: 'a.aleo', filter: { programs: [] } })
      expect(result.map((r) => r.commitment)).toEqual(['c1'])
    })

    it('applies no program bound when both program and programs are empty', () => {
      const mixed = [
        record({ programName: 'a.aleo', commitment: 'c1' }),
        record({ programName: 'b.aleo', commitment: 'c2' }),
      ]
      const result = applyRecordFilter(mixed, { filter: { programs: [] } })
      expect(result.map((r) => r.commitment)).toEqual(['c1', 'c2'])
    })
  })

  it('pages with resultsPerPage and a zero-based page index', () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      record({ blockHeight: i, commitment: `c${i}` }),
    )
    const page0 = applyRecordFilter(records, { filter: { resultsPerPage: 3, page: 0 } })
    const page1 = applyRecordFilter(records, { filter: { resultsPerPage: 3, page: 1 } })
    const page3 = applyRecordFilter(records, { filter: { resultsPerPage: 3, page: 3 } })
    expect(page0.map((r) => r.commitment)).toEqual(['c0', 'c1', 'c2'])
    expect(page1.map((r) => r.commitment)).toEqual(['c3', 'c4', 'c5'])
    expect(page3.map((r) => r.commitment)).toEqual(['c9'])
  })

  it('defaults to page 0 when only resultsPerPage is set', () => {
    const records = Array.from({ length: 5 }, (_, i) => record({ blockHeight: i, commitment: `c${i}` }))
    const result = applyRecordFilter(records, { filter: { resultsPerPage: 2 } })
    expect(result.map((r) => r.commitment)).toEqual(['c0', 'c1'])
  })

  it('returns an empty page past the end of the results', () => {
    const records = [record({ commitment: 'c1' })]
    expect(applyRecordFilter(records, { filter: { resultsPerPage: 10, page: 5 } })).toEqual([])
  })

  it('clamps resultsPerPage to the default page size', () => {
    const records = Array.from({ length: DEFAULT_RECORD_PAGE_SIZE + 5 }, (_, i) =>
      record({ blockHeight: i, commitment: `c${i}` }),
    )
    const result = applyRecordFilter(records, { filter: { resultsPerPage: DEFAULT_RECORD_PAGE_SIZE + 500 } })
    expect(result).toHaveLength(DEFAULT_RECORD_PAGE_SIZE)
  })

  it('caps an unpaged filtered scan at the default page size', () => {
    // A filtered scan is always paged, so an omitted resultsPerPage still
    // bounds the result set to one page.
    const records = Array.from({ length: DEFAULT_RECORD_PAGE_SIZE + 5 }, (_, i) =>
      record({ blockHeight: i, commitment: `c${i}` }),
    )
    expect(applyRecordFilter(records, { filter: {} })).toHaveLength(DEFAULT_RECORD_PAGE_SIZE)
  })

  it('skips the program bound when the provider already scoped the records', () => {
    // programScoped is set by callers whose request carried the program, so the
    // returned records are already restricted and re-testing could only drop
    // them — here the ids deliberately do not match.
    const records = [
      record({ programName: 'other.aleo', commitment: 'c1' }),
      record({ programName: 'other.aleo', commitment: 'c2' }),
    ]
    const scoped = applyRecordFilter(records, { program: 'token.aleo', filter: {} }, { programScoped: true })
    expect(scoped.map((r) => r.commitment)).toEqual(['c1', 'c2'])

    // Without the flag the bound applies, and nothing matches.
    const unscoped = applyRecordFilter(records, { program: 'token.aleo', filter: {} })
    expect(unscoped).toEqual([])
  })

  it('still applies the other bounds when the program bound is skipped', () => {
    const records = [
      record({ programName: 'other.aleo', recordName: 'Card', commitment: 'c1' }),
      record({ programName: 'other.aleo', recordName: 'Coupon', commitment: 'c2' }),
    ]
    const result = applyRecordFilter(
      records,
      { program: 'token.aleo', filter: { records: ['Card'] } },
      { programScoped: true },
    )
    expect(result.map((r) => r.commitment)).toEqual(['c1'])
  })

  it('rejects pagination values that cannot mean what they say', () => {
    // Previously silent and wrong: resultsPerPage -1 dropped the last record and
    // page -1 sliced from the end, both returning plausible-looking results.
    const records = [record({ commitment: 'c1' })]
    expect(() => applyRecordFilter(records, { filter: { resultsPerPage: -1 } })).toThrow(
      /resultsPerPage must be a positive integer/,
    )
    expect(() => applyRecordFilter(records, { filter: { page: -1 } })).toThrow(
      /page must be a non-negative integer/,
    )
  })

  it('does not mutate the caller array', () => {
    const records = [
      record({ blockHeight: 2, commitment: 'c2' }),
      record({ blockHeight: 1, commitment: 'c1' }),
    ]
    applyRecordFilter(records, { filter: {} })
    expect(records.map((r) => r.commitment)).toEqual(['c2', 'c1'])
  })
})
