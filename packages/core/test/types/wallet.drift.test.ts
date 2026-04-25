import { describe, it, expect } from 'vitest'
import type {
  Network as UpstreamNetwork,
  TransactionStatusResponse as UpstreamTransactionStatusResponse,
  TxHistoryResult as UpstreamTxHistoryResult,
} from '@provablehq/aleo-types'
import type {
  Network,
  TransactionStatusResponse,
  TxHistoryResult,
} from '../../src/types/wallet.js'

/**
 * Compile-time guard that the Provable wallet standard types declared in
 * `src/types/wallet.ts` stay structurally compatible with `@provablehq/aleo-types`.
 *
 * If upstream changes shape (adds a member, renames a field, etc.), the
 * `Assignable` checks below fail at typecheck time, prompting an update to
 * the local declarations.
 *
 * `Network` upstream is a string-valued enum — we compare against its
 * underlying string-literal type via `${UpstreamNetwork}`.
 */
type Assignable<A, B> = A extends B ? true : false

type _NetworkLocalToUpstream = Assignable<Network, `${UpstreamNetwork}`>
type _NetworkUpstreamToLocal = Assignable<`${UpstreamNetwork}`, Network>

type _TxStatusLocalToUpstream = Assignable<TransactionStatusResponse, UpstreamTransactionStatusResponse>
type _TxStatusUpstreamToLocal = Assignable<UpstreamTransactionStatusResponse, TransactionStatusResponse>

type _TxHistoryLocalToUpstream = Assignable<TxHistoryResult, UpstreamTxHistoryResult>
type _TxHistoryUpstreamToLocal = Assignable<UpstreamTxHistoryResult, TxHistoryResult>

const driftChecks: [
  _NetworkLocalToUpstream,
  _NetworkUpstreamToLocal,
  _TxStatusLocalToUpstream,
  _TxStatusUpstreamToLocal,
  _TxHistoryLocalToUpstream,
  _TxHistoryUpstreamToLocal,
] = [true, true, true, true, true, true]

describe('Provable wallet standard type drift', () => {
  it('stays structurally compatible with @provablehq/aleo-types', () => {
    expect(driftChecks.every((c) => c === true)).toBe(true)
  })
})
