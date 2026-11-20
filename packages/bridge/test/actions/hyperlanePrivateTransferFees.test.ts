import { describe, expect, it, vi } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { prepare } from '../../src/actions/prepare.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import {
  calculateHyperlanePrivateTransferAmount,
  readHyperlanePrivateTransferFeeBps,
  planHyperlanePrivateTransferFees,
  quoteAleoHyperlanePrivateTransfer,
  hyperlane,
} from '../../src/index.js'

const ROUTE = 'hyperlane:aleo/eth->ethereum/eth'
const FEE_MAPPING = 'private_transfer_fee_bps__'
const DEFAULT_HOOK = DEFAULT_BRIDGE_REGISTRY.routes.find(route => route.id === ROUTE)!.metadata!.aleoMailboxDefaultHook as string
const REQUIRED_HOOK = DEFAULT_BRIDGE_REGISTRY.routes.find(route => route.id === ROUTE)!.metadata!.aleoMailboxRequiredHook as string
const GAS = '{ gas_overhead: 159337u128, exchange_rate: 402u128, gas_price: 1000000000u128 }'
const MAX_U128 = (1n << 128n) - 1n

// Synthetic private-ABI activation for deterministic read-only tests only.
function fixture(options: { rate?: unknown; metadata?: Record<string, string | number | boolean>; gas?: string; hookType?: string } = {}) {
  const registry = { ...DEFAULT_BRIDGE_REGISTRY, routes: DEFAULT_BRIDGE_REGISTRY.routes.map(route => route.id === ROUTE
    ? { ...route, metadata: { ...route.metadata,
        aleoPrivateTransferAbi: 'transfer_remote_private_v1',
        aleoPrivateTransferCommit: 'c8b413bef975e736d9c9f52d4f4ce6113f8846ae',
        aleoPrivateTransferFeeMapping: FEE_MAPPING, aleoPrivateTransferFeeKey: 'false', ...options.metadata,
      } } : route) }
  const plan = prepare(registry, {
    source: { chain: 'aleo', asset: 'eth' }, destination: { chain: 'ethereum', asset: 'eth' },
    amount: '1', recipient: '0x0000000000000000000000000000000000000001',
  })
  const request = vi.fn(async ({ params }: { params: { mapping: string; key: string } }): Promise<unknown> => {
    if (params.mapping === FEE_MAPPING || params.mapping === 'private_transfer_fee_bps') return options.rate === undefined ? '25u16' : options.rate
    if (params.mapping === 'hooks') return options.hookType ?? (params.key === REQUIRED_HOOK ? '3u8' : '4u8')
    if (params.mapping === 'destination_gas_configs') return options.gas ?? GAS
    throw new Error(`Unexpected mapping ${params.mapping}`)
  })
  return { registry, plan, request, client: { request } as unknown as Client }
}

describe('private transfer token accounting', () => {
  it.each([0, 1, 25, 9999])('matches contract fee rounding at %i bps through u128::MAX', feeBps => {
    for (const amountAtomic of [1n, 399n, 400n, 10_001n, MAX_U128]) {
      const quote = calculateHyperlanePrivateTransferAmount({ amountAtomic, feeBps })
      expect(quote.protocolFeeAtomic).toBe(amountAtomic * BigInt(feeBps) / 10_000n)
      expect(quote.netAmountAtomic + quote.protocolFeeAtomic).toBe(amountAtomic)
    }
  })

  it.each([-1, 10000, 0.5, NaN])('rejects invalid fee bps %s', feeBps => {
    expect(() => calculateHyperlanePrivateTransferAmount({ amountAtomic: 100n, feeBps })).toThrow(/fee rate/)
  })

  it.each([0n, -1n, MAX_U128 + 1n])('rejects invalid gross token amounts %s', amountAtomic => {
    expect(() => calculateHyperlanePrivateTransferAmount({ amountAtomic, feeBps: 25 })).toThrow(/positive u128/)
  })

  it('includes the token fee in gross funding and separates both credits sources', () => {
    const fees = planHyperlanePrivateTransferFees({ amountAtomic: 10_000n, feeBps: 25, dispatchCreditsMicrocredits: 100n })
    expect(fees).toEqual({ grossAmountAtomic: 10_000n, protocolFeeAtomic: 25n, netAmountAtomic: 9975n,
      feeBps: 25, tokenRecordAmountAtomic: 10_000n, dispatchCreditsRecordMicrocredits: 100n,
      executionFeeMicrocredits: null, totalMicrocredits: null,
    })
    expect(planHyperlanePrivateTransferFees({ amountAtomic: 10_000n, feeBps: 25, dispatchCreditsMicrocredits: 100n, executionFeeMicrocredits: 500n }).totalMicrocredits).toBe(600n)
  })

  it.each([-1n, 1n << 64n])('rejects invalid credits amounts %s', amount => {
    expect(() => planHyperlanePrivateTransferFees({ amountAtomic: 100n, feeBps: 25, dispatchCreditsMicrocredits: amount })).toThrow(/u64/)
    expect(() => planHyperlanePrivateTransferFees({ amountAtomic: 100n, feeBps: 25, dispatchCreditsMicrocredits: 0n, executionFeeMicrocredits: amount })).toThrow(/u64/)
  })
})

describe('private transfer on-chain fee quote', () => {
  it('reads the reviewed deployed fee slot and deducts the fee from expected destination tokens', async () => {
    const { registry, plan, client, request } = fixture()
    const quote = await hyperlane.aleo.quotePrivateTransfer(client, { registry, plan })
    expect(request).toHaveBeenCalledWith({ method: 'getMappingValue', params: {
      programId: 'hyp_warp_token_eth_v2.aleo', mapping: 'private_transfer_fee_bps__', key: 'false',
    } })
    expect(quote).toMatchObject({ grossAmountAtomic: 10n ** 18n, protocolFeeAtomic: 2_500_000_000_000_000n,
      netAmountAtomic: 997_500_000_000_000_000n, destinationAmountAtomic: 997_500_000_000_000_000n,
      amountIn: '1', amountOut: '0.9975', tokenRecordAmountAtomic: 10n ** 18n,
      dispatchCreditsRecordMicrocredits: 8_174_147n, executionFeeMicrocredits: null, totalMicrocredits: null,
    })
    expect(quote.hookPayments).toEqual([
      { hook: DEFAULT_HOOK, paymentMicrocredits: 8_174_147n }, { hook: REQUIRED_HOOK, paymentMicrocredits: 0n },
    ])
  })

  it('supports an explicitly reviewed older mapping slot without guessing a fallback', async () => {
    const { registry, plan, client, request } = fixture({ metadata: { aleoPrivateTransferFeeMapping: 'private_transfer_fee_bps', aleoPrivateTransferFeeKey: 'true' } })
    await quoteAleoHyperlanePrivateTransfer(registry, client, { plan })
    expect(request.mock.calls[0]![0].params).toMatchObject({ mapping: 'private_transfer_fee_bps', key: 'true' })
  })

  it.each([null, 'null'])('defaults only an absent fee entry to zero (%s)', async rate => {
    const { registry, plan, client } = fixture({ rate })
    expect((await quoteAleoHyperlanePrivateTransfer(registry, client, { plan })).protocolFeeAtomic).toBe(0n)
  })

  it.each(['10000u16', '65535u16', '25u64', '-1u16', {}, 'bad'])('rejects invalid fee response %s', async rate => {
    const { registry, plan, client } = fixture({ rate })
    await expect(quoteAleoHyperlanePrivateTransfer(registry, client, { plan })).rejects.toThrow(/Invalid Hyperlane private transfer fee/)
  })

  it('propagates fee lookup failures rather than treating them as zero', async () => {
    const { registry, plan, client, request } = fixture()
    request.mockRejectedValueOnce(new Error('Aleo unavailable'))
    await expect(quoteAleoHyperlanePrivateTransfer(registry, client, { plan })).rejects.toThrow(/Aleo unavailable/)
  })

  it('reads a fresh fee every time instead of caching a stale quote', async () => {
    const { registry, plan, client, request } = fixture()
    expect((await quoteAleoHyperlanePrivateTransfer(registry, client, { plan })).feeBps).toBe(25)
    request.mockImplementationOnce(async () => '50u16')
    const fresh = await quoteAleoHyperlanePrivateTransfer(registry, client, { plan })
    expect(fresh.feeBps).toBe(50)
    expect(fresh.amountOut).toBe('0.995')
  })

  it('charges both hook invocations even when they refer to the same IGP', async () => {
    const { registry, plan, client } = fixture({ metadata: { aleoMailboxRequiredHook: DEFAULT_HOOK } })
    const quote = await quoteAleoHyperlanePrivateTransfer(registry, client, { plan })
    expect(quote.dispatchCreditsRecordMicrocredits).toBe(16_348_294n)
    expect(quote.hookPayments).toHaveLength(2)
  })

  it('honors a custom effective hook and permits reviewed no-op dispatch payments', async () => {
    const { registry, plan, client, request } = fixture({ metadata: { aleoHook: REQUIRED_HOOK }, hookType: '0u8' })
    const quote = await quoteAleoHyperlanePrivateTransfer(registry, client, { plan })
    expect(quote.dispatchCreditsRecordMicrocredits).toBe(0n)
    expect(quote.hookPayments.every(payment => payment.hook === REQUIRED_HOOK)).toBe(true)
    expect(request.mock.calls.some(args => args[0].params.mapping === 'destination_gas_configs')).toBe(false)
  })

  it('uses the 50000 gas-limit fallback for a reviewed zero limit', async () => {
    const { registry, plan, client } = fixture({ metadata: { aleoRemoteRouterGas: '0' } })
    expect((await quoteAleoHyperlanePrivateTransfer(registry, client, { plan })).dispatchCreditsRecordMicrocredits).toBe(8_415_347n)
  })

  it.each(['1u8', '4u16'])('rejects unknown or malformed hook types %s', async hookType => {
    const { registry, plan, client } = fixture({ hookType })
    await expect(quoteAleoHyperlanePrivateTransfer(registry, client, { plan })).rejects.toThrow(/hook type/)
  })

  it.each([
    '{ gas_overhead: 0u128, gas_price: 1u64, exchange_rate: 1u128 }',
    '{ gas_overhead: 0u128, gas_price: 1u128, gas_price: 2u128, exchange_rate: 1u128 }',
    `{ gas_overhead: ${MAX_U128}u128, gas_price: 1u128, exchange_rate: 1u128 }`,
    `{ gas_overhead: 0u128, gas_price: ${MAX_U128}u128, exchange_rate: 1u128 }`,
  ])('rejects malformed or overflowing hook gas configuration', async gas => {
    const { registry, plan, client } = fixture({ gas })
    await expect(quoteAleoHyperlanePrivateTransfer(registry, client, { plan })).rejects.toThrow()
  })

  it('rejects a combined dispatch record requirement that exceeds u64', async () => {
    const { registry, plan, client } = fixture({
      metadata: { aleoMailboxRequiredHook: DEFAULT_HOOK, aleoRemoteRouterGas: '1' },
      gas: `{ gas_overhead: 0u128, gas_price: ${(1n << 63n) * 10_000_000_000n}u128, exchange_rate: 1u128 }`,
    })
    await expect(quoteAleoHyperlanePrivateTransfer(registry, client, { plan })).rejects.toThrow(/u64/)
  })

  it('requires explicit reviewed private ABI and fee metadata before any reads', async () => {
    const { plan, client, request } = fixture()
    await expect(quoteAleoHyperlanePrivateTransfer(DEFAULT_BRIDGE_REGISTRY, client, { plan })).rejects.toThrow(/reviewed ABI/)
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects invalid recipients before any fee reads', async () => {
    const { registry, plan, client, request } = fixture()
    await expect(quoteAleoHyperlanePrivateTransfer(registry, client, { plan: { ...plan, recipient: 'bad' } })).rejects.toThrow(/recipient/)
    expect(request).not.toHaveBeenCalled()
  })

  it('converts net local tokens to destination units, rounding down only at conversion', async () => {
    const { registry, plan, client } = fixture()
    const differentDecimals = { ...registry, assets: registry.assets.map(asset => asset.id === plan.destinationAsset.id ? { ...asset, decimals: 6 } : asset),
      routes: registry.routes.map(route => route.id === ROUTE ? { ...route, metadata: { ...route.metadata, aleoRemoteDecimals: 6 } } : route),
    }
    const quote = await quoteAleoHyperlanePrivateTransfer(differentDecimals, client, { plan })
    expect(quote.destinationAmountAtomic).toBe(997_500n)
    expect(quote.amountOut).toBe('0.9975')
  })

  it('validates a standalone fee slot before querying a client', async () => {
    const { client, request } = fixture()
    await expect(readHyperlanePrivateTransferFeeBps(client, { program: 'bad', mapping: FEE_MAPPING, key: 'false' })).rejects.toThrow(/mapping/)
    expect(request).not.toHaveBeenCalled()
  })
})
