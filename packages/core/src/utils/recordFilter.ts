// Record-scan filter semantics: Veil's contract for what a RecordFilter means.
//
// A provider that can push the filter to its backend does so. One that cannot —
// a wallet adapter, whose protocol carries only program, plaintext, and spent
// status — leaves the bounds unapplied, and the requestRecords action applies
// them here instead. Both paths answer to the definitions below, so this module
// is where they live.

import type { OwnedRecordEncrypted, RequestRecordsParameters } from '../types/records.js'

/**
 * Records one page of a filtered scan returns when `resultsPerPage` is unset.
 *
 * Veil's default page size, not a backend's limit. A provider MAY additionally
 * cap a page below this — the Provable Record Scanning Service clamps to exactly
 * this value — so a filtered scan over more matching records than this MUST page
 * to read them all.
 */
export const DEFAULT_RECORD_PAGE_SIZE = 1000

// Resolves the program scope as a Set, which is what membership testing wants.
// The exported array form below is for callers building a request body.
function resolveScanProgramSet(params: RequestRecordsParameters): Set<string> | undefined {
  const fromFilter = params.filter?.programs
  if (!fromFilter?.length) {
    return params.program ? new Set([params.program]) : undefined
  }
  return new Set(params.program ? [params.program, ...fromFilter] : fromFilter)
}

/**
 * Resolves the program ids a scan is scoped to.
 *
 * `program` is the common-case shorthand and `filter.programs` the list form;
 * setting both scans the union rather than letting one silently win. Pure and
 * local.
 *
 * @param params Scan parameters carrying either, both, or neither.
 * @returns The deduplicated program ids, or `undefined` when neither is set —
 *   which scans every program rather than none.
 *
 * @example
 * resolveScanPrograms({ program: 'a.aleo', filter: { programs: ['b.aleo'] } })
 * // ['a.aleo', 'b.aleo']
 */
export function resolveScanPrograms(params: RequestRecordsParameters): string[] | undefined {
  const programs = resolveScanProgramSet(params)
  return programs ? [...programs] : undefined
}

// Orders records by block height then commitment, so a page index selects the
// same records however the filter was applied. Records missing either field sort
// last rather than scrambling the ones that carry it.
function compareRecords(a: OwnedRecordEncrypted, b: OwnedRecordEncrypted): number {
  const heightA = a.blockHeight ?? Number.MAX_SAFE_INTEGER
  const heightB = b.blockHeight ?? Number.MAX_SAFE_INTEGER
  if (heightA !== heightB) return heightA - heightB
  return (a.commitment ?? '').localeCompare(b.commitment ?? '')
}

// A membership bound excludes a record whose field is absent: the bound cannot
// be confirmed, and admitting an unconfirmed record would hand back a type the
// caller filtered out. Stated once here rather than per field, so a new bound
// cannot quietly diverge.
function outsideBound(bound: Set<string> | undefined, value: string | undefined): boolean {
  return bound !== undefined && (value === undefined || !bound.has(value))
}

/**
 * Applies a record filter to records already in hand.
 *
 * Covers providers that cannot push the bounds to their backend — the wallet
 * adapter path, whose protocol has no representation for them. Fields combine as
 * AND across the filter and OR within one field, and matches are ordered by
 * block height then commitment before paging.
 *
 * A membership bound (`records`, `functions`, `commitments`, `programs`) excludes
 * a record that does not carry the field it tests, as does a block-range bound
 * against a record with no height. This matters for a privacy-preserving wallet:
 * fields withheld under a `recordAccess` grant are absent, so a bound on a
 * withheld field matches nothing and the scan returns empty. Filter on fields the
 * connection actually grants.
 *
 * Spent status is not applied here — a wallet adapter receives `statusFilter`
 * directly and has already honored it.
 *
 * Returns the input untouched — same order, no copy — when `params.filter` is
 * absent, so an unfiltered call behaves exactly as before. Pure and local.
 *
 * @param records Records as the provider returned them.
 * @param params Scan parameters whose `filter` and `program` supply the bounds.
 * @returns The matching records for the requested page.
 *
 * @example
 * applyRecordFilter(walletRecords, {
 *   program: 'shield_swap.aleo',
 *   filter: { records: ['Position'], start: 8_400_000, resultsPerPage: 50 },
 * })
 */
export function applyRecordFilter<T extends OwnedRecordEncrypted>(
  records: T[],
  params: RequestRecordsParameters,
): T[] {
  const filter = params.filter
  if (!filter) return records

  // Built once per scan rather than per record: a filter listing many
  // commitments would otherwise turn every test into a linear scan.
  const toBound = (values?: string[]) => (values ? new Set(values) : undefined)
  const programs = resolveScanProgramSet(params)
  const recordNames = toBound(filter.records)
  const functions = toBound(filter.functions)
  const commitments = toBound(filter.commitments)

  const matched = records.filter((record) => {
    if (outsideBound(programs, record.programName)) return false
    if (outsideBound(recordNames, record.recordName)) return false
    if (outsideBound(functions, record.functionName)) return false
    if (outsideBound(commitments, record.commitment)) return false
    // Range bounds follow the same rule: a record with no height cannot satisfy
    // one, so it is excluded rather than read as height 0.
    if (filter.start !== undefined && (record.blockHeight === undefined || record.blockHeight < filter.start)) {
      return false
    }
    if (filter.end !== undefined && (record.blockHeight === undefined || record.blockHeight > filter.end)) {
      return false
    }
    return true
  })

  matched.sort(compareRecords)

  const perPage = Math.min(filter.resultsPerPage ?? DEFAULT_RECORD_PAGE_SIZE, DEFAULT_RECORD_PAGE_SIZE)
  const offset = (filter.page ?? 0) * perPage
  return matched.slice(offset, offset + perPage)
}
