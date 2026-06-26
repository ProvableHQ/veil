// Wallet-fulfilled transaction inputs and connect-time privacy grants.
// Local mirrors of the Provable wallet-standard shapes (field-for-field), so
// @provablehq/* stays out of @veil/core's public surface.

/** Wallet-side derivation algorithms known to Veil; any string is also accepted. */
export const KNOWN_ALGORITHMS = [
  'program-scoped-blinding-factor',
  'program-scoped-blinded-address',
] as const

/** A known derivation algorithm name. */
export type KnownAlgorithm = (typeof KNOWN_ALGORITHMS)[number]

/** A derivation algorithm name — a known one, or any other string the wallet supports. */
export type AlgorithmName = KnownAlgorithm | (string & {})

/** Aleo type tag for a derived-input argument value (a literal type or "string"). */
export type ArgType = string

/**
 * One argument to a `derived` input's algorithm.
 *
 * @property type Aleo type tag for `value` (e.g. "address", "string").
 * @property value The argument, as an Aleo-encoded string.
 */
export interface AlgorithmArg {
  type: ArgType
  value: string
}

/**
 * Comparison filter for one record field, used to auto-select a record.
 *
 * @property eq Match records whose field equals this Aleo-encoded value.
 * @property neq Match records whose field does not equal this value.
 * @property gte Match records whose field is >= this value.
 * @property lte Match records whose field is <= this value.
 */
export interface RecordFieldFilter {
  eq?: string
  neq?: string
  gte?: string
  lte?: string
}

/** Field name → comparison filter, for wallet-side record auto-selection. */
export type RecordFilters = Record<string, RecordFieldFilter>

/**
 * A transaction input the wallet fulfils instead of the dapp, so private values
 * never reach the dapp.
 *
 * - `address`: the wallet injects its own active address into the slot.
 * - `record`: the wallet supplies an owned record — pinned by `uid` (from a
 *   prior `requestRecords`) or auto-selected by `filters`. `uid` and `filters`
 *   are mutually exclusive.
 * - `derived`: the wallet runs `algorithm` over its private state and substitutes
 *   the result.
 */
export type InputRequest =
  | { type: 'address'; label?: string }
  | {
      type: 'record'
      program: string
      recordname: string
      filters?: RecordFilters
      uid?: string
    }
  | {
      type: 'derived'
      algorithm: AlgorithmName
      args: Record<string, AlgorithmArg>
      label?: string
    }

/** A transaction input: an Aleo-encoded literal string, or a wallet-fulfilled request. */
export type TransactionInput = string | InputRequest

/** A single field-access grant within a record grant. */
export interface FieldGrant {
  name: string
  readAccess?: boolean
}

/** Grants access to specific records (and optionally fields) of a program. */
export interface RecordGrant {
  recordname: string
  fields?: FieldGrant[]
}

/** Grants record access scoped to one program. */
export interface ProgramGrant {
  program: string
  records?: RecordGrant[]
}

/** Connect-time record-access grant: deny all, or scope by program. */
export type RecordAccessGrant =
  | { level: 'none' }
  | { level: 'byProgram'; programs: ProgramGrant[] }

/** Constraint on a derived-algorithm argument: an allowlist of values, or "any". */
export type ArgConstraint = string[] | 'any'

/**
 * Connect-time authorization for one `derived` algorithm at a specific call site.
 *
 * @property algorithm The algorithm this grant authorizes.
 * @property program Program the algorithm may run for.
 * @property function Function the algorithm may run for.
 * @property inputPosition Input slot the derived value may fill.
 * @property argConstraints Optional per-argument allowlists.
 */
export interface AlgorithmGrant {
  algorithm: AlgorithmName
  program: string
  function: string
  inputPosition: number
  argConstraints?: Record<string, ArgConstraint>
}

/**
 * Connect-time privacy grants passed to a wallet's `connect`.
 *
 * @property recordAccess Which records/fields the dapp may read.
 * @property readAddress Whether the dapp may learn the address. Defaults to true;
 *   set false to transact without ever receiving it.
 * @property algorithmsAllowed Allowlist authorizing `derived` inputs; undefined
 *   means all derived inputs are refused.
 */
export interface ConnectOptions {
  recordAccess?: RecordAccessGrant
  readAddress?: boolean
  algorithmsAllowed?: AlgorithmGrant[]
}

/**
 * Narrows a transaction input to a wallet-fulfilled request.
 *
 * @param input A transaction input — a literal string or an InputRequest.
 * @returns True if the input is an InputRequest (address/record/derived).
 */
export function isInputRequest(input: TransactionInput): input is InputRequest {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input.type === 'address' || input.type === 'record' || input.type === 'derived')
  )
}

/**
 * Asserts that no input is wallet-fulfilled, narrowing to encoded strings.
 *
 * The local-proving path can only handle Aleo-encoded string inputs; address,
 * record, and derived requests require a wallet to resolve them.
 *
 * @param inputs The transaction inputs to check.
 * @throws If any input is an InputRequest — use a wallet (RPC) account instead.
 */
export function assertNoInputRequests(
  inputs: TransactionInput[],
): asserts inputs is string[] {
  if (inputs.some(isInputRequest)) {
    throw new Error(
      'Wallet-specified inputs (address/record/derived) require a wallet account. ' +
        'The local-proving path only accepts Aleo-encoded string inputs.',
    )
  }
}
