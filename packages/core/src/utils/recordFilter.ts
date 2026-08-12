// Record-scan filter semantics: Veil's contract for what a RecordFilter means.
//
// A provider that can push the filter to its backend does so. One that cannot —
// a wallet adapter, whose protocol carries only program, plaintext, and spent
// status — leaves the bounds unapplied, and the requestRecords action applies
// them here instead. Both paths answer to the definitions below, so this module
// is where they live.

import type { OwnedRecordEncrypted, RecordFilter, RequestRecordsParameters } from '../types/records.js'

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
// same records however the filter was applied. A record missing either field
// sorts after one that carries it — the same rule for both keys, rather than
// letting an absent commitment sort first as an empty string would.
function compareRecords(a: OwnedRecordEncrypted, b: OwnedRecordEncrypted): number {
  const heightA = a.blockHeight ?? Number.MAX_SAFE_INTEGER
  const heightB = b.blockHeight ?? Number.MAX_SAFE_INTEGER
  if (heightA !== heightB) return heightA - heightB
  if (a.commitment === b.commitment) return 0
  if (a.commitment === undefined) return 1
  if (b.commitment === undefined) return -1
  return a.commitment.localeCompare(b.commitment)
}

// Turns a filter field into a membership bound. An empty array is no bound at
// all, matching how an omitted field behaves — a caller narrowing by a list that
// happened to come back empty means "no constraint", not "match nothing".
function toBound(values?: string[]): Set<string> | undefined {
  return values && values.length > 0 ? new Set(values) : undefined
}

// A membership bound excludes a record whose field is absent: the bound cannot
// be confirmed, and admitting an unconfirmed record would hand back a type the
// caller filtered out. Stated once here rather than per field, so a new bound
// cannot quietly diverge.
function outsideBound(bound: Set<string> | undefined, value: string | undefined): boolean {
  return bound !== undefined && (value === undefined || !bound.has(value))
}

/**
 * Rejects pagination values that cannot mean what they say.
 *
 * Called on both scan paths, so the same input fails the same way whether the
 * filter is applied locally or pushed to a backend. The record scanning service
 * types these as unsigned integers and rejects a negative outright; failing here
 * reports the offending field instead of surfacing a deserialization error from
 * the far end. Pure and local.
 *
 * @param filter Filter to check. A filter without pagination always passes.
 * @throws When `resultsPerPage` is not a positive integer, or `page` is not a
 *   non-negative integer.
 *
 * @example
 * assertValidRecordFilter({ page: -1 }) // throws
 */
export function assertValidRecordFilter(filter?: RecordFilter): void {
  const { resultsPerPage, page } = filter ?? {}
  if (resultsPerPage !== undefined && (!Number.isInteger(resultsPerPage) || resultsPerPage < 1)) {
    throw new Error(
      `requestRecords filter.resultsPerPage must be a positive integer (received ${resultsPerPage}).`,
    )
  }
  if (page !== undefined && (!Number.isInteger(page) || page < 0)) {
    throw new Error(
      `requestRecords filter.page must be a non-negative integer (received ${page}).`,
    )
  }
}

/**
 * Options for {@link applyRecordFilter}.
 *
 * @property programScoped Whether the provider already restricted the records to
 *   the requested program. Defaults to false. Set it when the records came from a
 *   source that scoped them — the wallet-adapter protocol always does, since it
 *   takes the program as a request parameter. Skipping the redundant re-test
 *   matters because it can only remove records: a provider that spells a program
 *   id differently from the caller would otherwise drop every one of them and
 *   return an empty result with no error.
 */
export type ApplyRecordFilterOptions = {
  programScoped?: boolean
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
 * An empty array is not a bound. `commitments: []` applies no constraint, exactly
 * as omitting the field does, rather than matching nothing.
 *
 * Spent status is not applied here — a wallet adapter receives `statusFilter`
 * directly and has already honored it.
 *
 * Returns the input untouched — same order, no copy — when `params.filter` is
 * absent, so an unfiltered call behaves exactly as before. Pure and local.
 *
 * @param records Records as the provider returned them.
 * @param params Scan parameters whose `filter` and `program` supply the bounds.
 * @param options Whether the provider already scoped the records to the program.
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
  options: ApplyRecordFilterOptions = {},
): T[] {
  const filter = params.filter
  if (!filter) return records
  assertValidRecordFilter(filter)

  // Built once per scan rather than per record: a filter listing many
  // commitments would otherwise turn every test into a linear scan.
  //
  // The program bound is skipped when the provider already scoped the result:
  // re-testing it could only ever remove records, and would remove all of them
  // if the provider spells a program id differently from the caller.
  const programs = options.programScoped ? undefined : resolveScanProgramSet(params)
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
