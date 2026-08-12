// Record Scanning Service wire encoding.
//
// Internal to this package — deliberately absent from package.json `exports`, so
// the request body shape stays an implementation detail rather than semver-bound
// public API. Tests import it by path.

import type { OwnedFilter } from '@provablehq/sdk'
import { resolveScanPrograms, type RequestRecordsParameters } from '@provablehq/veil-core'

/**
 * Builds the `/records/owned` request body for a record scan.
 *
 * Translates Veil's camelCase {@link RequestRecordsParameters} into the field
 * names the Record Scanning Service deserializes — `resultsPerPage` becomes
 * `results_per_page`, which is why this cannot be a pass-through. The SDK's
 * `owned()` JSON-stringifies the object verbatim, so what is built here is what
 * the service receives. Pure and local.
 *
 * `unspent` is tri-state by presence rather than by value: the service turns
 * `unspent: true` into `spent = false` and `unspent: false` into `spent = true`,
 * so `'all'` MUST omit the key entirely. Sending `true` for it would return
 * unspent records only.
 *
 * The column mask the service reads (a top-level `response_filter`) is
 * deliberately absent. `filter.response` is ignored by the owned endpoint, and a
 * mask omitting `record_ciphertext` would leave every record undecryptable — see
 * `RecordFilter`'s docs on `response`.
 *
 * The service clamps `results_per_page` to 1000 and defaults `page` to 0, so a
 * scan matching more records than one page holds returns a page rather than
 * failing. This is the backend limit that Veil's `DEFAULT_RECORD_PAGE_SIZE`
 * matches.
 *
 * @param params Program, spent-status filter, and row filter for the scan.
 * @returns The request body, carrying only the keys the parameters set.
 *
 * @example
 * buildOwnedFilter({ program: 'credits.aleo', statusFilter: 'unspent' })
 * // { unspent: true, filter: { programs: ['credits.aleo'] } }
 */
export function buildOwnedFilter(params: RequestRecordsParameters): OwnedFilter {
  const filter = params.filter

  // One entry per wire field, one omission rule. Naming each field once keeps a
  // copy-paste from silently pairing the wrong source and target.
  const wireFilter = Object.fromEntries(
    Object.entries({
      programs: resolveScanPrograms(params),
      records: filter?.records,
      functions: filter?.functions,
      commitments: filter?.commitments,
      start: filter?.start,
      end: filter?.end,
      results_per_page: filter?.resultsPerPage,
      page: filter?.page,
    }).filter(([, value]) => value !== undefined),
  )

  const body: OwnedFilter = {}
  // Omitted for 'all' and for an unset status, which both mean no spent clause.
  if (params.statusFilter === 'unspent') body.unspent = true
  else if (params.statusFilter === 'spent') body.unspent = false
  // An empty filter object narrows nothing; leave it off so the body stays the
  // minimal expression of the request.
  if (Object.keys(wireFilter).length > 0) body.filter = wireFilter
  return body
}
