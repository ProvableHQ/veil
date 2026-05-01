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
 * `src/types/wallet.ts` accept everything `@provablehq/aleo-types` produces.
 *
 * `Network` is intentionally *wider* than upstream (we accept any string for
 * forward-compat with new networks), so only the upstream → local direction
 * is asserted. The other types are structurally identical, asserted both ways.
 */
type Assignable<A, B> = A extends B ? true : false

type _NetworkUpstreamToLocal = Assignable<`${UpstreamNetwork}`, Network>

type _TxStatusLocalToUpstream = Assignable<TransactionStatusResponse, UpstreamTransactionStatusResponse>
type _TxStatusUpstreamToLocal = Assignable<UpstreamTransactionStatusResponse, TransactionStatusResponse>

type _TxHistoryLocalToUpstream = Assignable<TxHistoryResult, UpstreamTxHistoryResult>
type _TxHistoryUpstreamToLocal = Assignable<UpstreamTxHistoryResult, TxHistoryResult>

const driftChecks: [
  _NetworkUpstreamToLocal,
  _TxStatusLocalToUpstream,
  _TxStatusUpstreamToLocal,
  _TxHistoryLocalToUpstream,
  _TxHistoryUpstreamToLocal,
] = [true, true, true, true, true]

describe('Provable wallet standard type drift', () => {
  it('accepts everything @provablehq/aleo-types produces', () => {
    expect(driftChecks.every((c) => c === true)).toBe(true)
  })
})
