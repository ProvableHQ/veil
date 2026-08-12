import { describe, it, expect } from 'vitest'
import { buildOwnedFilter } from '../src/utils/rss.js'

// These assertions pin the wire contract of POST /records/owned. The service
// deserializes snake_case field names and ignores keys it does not know, so a
// casing slip here fails silently in production — hence exact-shape assertions
// rather than partial matches.
describe('buildOwnedFilter', () => {
  describe('spent status', () => {
    it("omits unspent for 'all' so no spent clause is applied", () => {
      // The service reads `unspent: true` as `spent = false`. Sending it for
      // 'all' would return unspent records only.
      expect(buildOwnedFilter({ program: 'a.aleo', statusFilter: 'all' })).toEqual({
        filter: { programs: ['a.aleo'] },
      })
    })

    it('omits unspent when no status filter is given', () => {
      expect(buildOwnedFilter({ program: 'a.aleo' })).toEqual({
        filter: { programs: ['a.aleo'] },
      })
    })

    it("sends unspent: true for 'unspent'", () => {
      expect(buildOwnedFilter({ program: 'a.aleo', statusFilter: 'unspent' })).toEqual({
        unspent: true,
        filter: { programs: ['a.aleo'] },
      })
    })

    it("sends unspent: false for 'spent'", () => {
      expect(buildOwnedFilter({ program: 'a.aleo', statusFilter: 'spent' })).toEqual({
        unspent: false,
        filter: { programs: ['a.aleo'] },
      })
    })
  })

  describe('program scoping', () => {
    it('wraps a bare program as a programs list', () => {
      expect(buildOwnedFilter({ program: 'credits.aleo' })).toEqual({
        filter: { programs: ['credits.aleo'] },
      })
    })

    it('omits the filter entirely when no program and no filter are given', () => {
      // An all-programs scan: the service applies no program clause.
      expect(buildOwnedFilter({})).toEqual({})
    })

    it('unions the top-level program with filter.programs', () => {
      expect(buildOwnedFilter({ program: 'a.aleo', filter: { programs: ['b.aleo'] } })).toEqual({
        filter: { programs: ['a.aleo', 'b.aleo'] },
      })
    })

    it('sends filter.programs alone when no top-level program is given', () => {
      expect(buildOwnedFilter({ filter: { programs: ['a.aleo', 'b.aleo'] } })).toEqual({
        filter: { programs: ['a.aleo', 'b.aleo'] },
      })
    })
  })

  describe('row filters', () => {
    it('passes records, functions, and commitments through unchanged', () => {
      expect(
        buildOwnedFilter({
          filter: {
            records: ['Position'],
            functions: ['mint_position'],
            commitments: ['1field'],
          },
        }),
      ).toEqual({
        filter: {
          records: ['Position'],
          functions: ['mint_position'],
          commitments: ['1field'],
        },
      })
    })

    it('sends the block range as start and end', () => {
      expect(buildOwnedFilter({ filter: { start: 100, end: 200 } })).toEqual({
        filter: { start: 100, end: 200 },
      })
    })

    it('keeps a zero block range bound rather than dropping it as falsy', () => {
      expect(buildOwnedFilter({ filter: { start: 0, end: 0 } })).toEqual({
        filter: { start: 0, end: 0 },
      })
    })
  })

  describe('pagination', () => {
    it('renames resultsPerPage to the snake_case wire field', () => {
      const body = buildOwnedFilter({ filter: { resultsPerPage: 50 } })
      expect(body).toEqual({ filter: { results_per_page: 50 } })
      // The camelCase form would be silently ignored by the service.
      expect(JSON.stringify(body)).not.toContain('resultsPerPage')
    })

    it('sends page as-is', () => {
      expect(buildOwnedFilter({ filter: { page: 3 } })).toEqual({ filter: { page: 3 } })
    })

    it('keeps page 0 rather than dropping it as falsy', () => {
      expect(buildOwnedFilter({ filter: { page: 0 } })).toEqual({ filter: { page: 0 } })
    })
  })

  describe('omissions', () => {
    it('omits the filter for an empty filter object', () => {
      expect(buildOwnedFilter({ filter: {} })).toEqual({})
    })

    it('does not send the response mask, which the owned endpoint ignores', () => {
      const body = buildOwnedFilter({
        program: 'a.aleo',
        filter: { response: { commitment: true } },
      })
      expect(body).toEqual({ filter: { programs: ['a.aleo'] } })
      expect(JSON.stringify(body)).not.toContain('response')
    })

    it('sends no unrecognized keys for a fully populated filter', () => {
      const body = buildOwnedFilter({
        program: 'a.aleo',
        includePlaintext: false,
        statusFilter: 'unspent',
        filter: {
          programs: ['b.aleo'],
          records: ['R'],
          functions: ['f'],
          commitments: ['1field'],
          start: 1,
          end: 2,
          resultsPerPage: 10,
          page: 1,
        },
      })
      expect(body).toEqual({
        unspent: true,
        filter: {
          programs: ['a.aleo', 'b.aleo'],
          records: ['R'],
          functions: ['f'],
          commitments: ['1field'],
          start: 1,
          end: 2,
          results_per_page: 10,
          page: 1,
        },
      })
      // includePlaintext is a local decryption toggle, not a service field.
      expect(JSON.stringify(body)).not.toContain('includePlaintext')
    })
  })
})
