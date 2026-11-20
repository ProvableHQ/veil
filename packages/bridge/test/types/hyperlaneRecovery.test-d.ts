import { expectTypeOf, test } from 'vitest'
import {
  readHyperlaneClaimableAmount,
  scanHyperlaneAddressEncodings,
  type BridgeCheckpoint,
  type BridgeClient,
  type HyperlaneAddressEncodingScanResult,
} from '../../src/index.js'

test('distinguishes absent encodings from zero balances in the public read result', () => {
  expectTypeOf<Awaited<ReturnType<typeof readHyperlaneClaimableAmount>>>().toEqualTypeOf<bigint | null>()
})

test('returns only public counter discovery data', () => {
  expectTypeOf<Awaited<ReturnType<typeof scanHyperlaneAddressEncodings>>>().toEqualTypeOf<HyperlaneAddressEncodingScanResult>()
  expectTypeOf<keyof HyperlaneAddressEncodingScanResult['entries'][number]>().toEqualTypeOf<'counter' | 'addressEncoding' | 'claimableAmount'>()
})

test('accepts recovery without source or destination transaction identifiers', () => {
  const checkpoint: BridgeCheckpoint = {
    version: 1,
    intent: {
      source: { chain: 'ethereum', asset: 'eth' }, destination: { chain: 'aleo', asset: 'eth' },
      bridgeProtocol: 'hyperlane', amount: '0.001', recipient: 'aleo1...', mintMode: 'private',
      hyperlane: { addressEncoding: { commitmentHex: '11'.repeat(32) } },
    },
    route: { id: 'hyperlane:ethereum/eth->aleo/eth', registryVersion: 'reviewed' },
  }
  expectTypeOf({ checkpoint }).toMatchTypeOf<Parameters<BridgeClient['recover']>[0]>()
})
