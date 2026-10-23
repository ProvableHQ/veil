import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { ShieldSwapActions, SwapQuote } from '@provablehq/shield-swap-sdk'
import { submitConcurrentSwaps } from './concurrent-swaps.js'

const offer: SwapQuote = {
  version: 1, network: 'testnet', program: 'shield_swap.aleo',
  from: { id: '1field', symbol: 'USDCx', decimals: 6 },
  to: { id: '2field', symbol: 'ETH', decimals: 18 },
  amountIn: 100_000n, expectedOut: 100n, minOut: 99n, slippageBps: 100,
  hops: [{ poolKey: '3field', tokenInId: '1field', tokenOutId: '2field' }],
  quotedAt: 1, expiresAt: 60_001, protocolRevision: 1,
}
type Handle = Awaited<ReturnType<ShieldSwapActions['swap']>>
// Network-bound actions are substituted here; these tests exercise the example's
// scheduling and recovery logic. Record contention is covered by the SDK suites.
const handle = (id: number) => ({ transactionId: `swap-${id}`, swapId: `${id}field`, program: 'shield_swap.aleo' }) as Handle

it('starts every swap before awaiting results and claims successes despite a failed submission', async () => {
  const releases: Array<(value: Handle) => void> = []
  const failed = new Error('submission outcome uncertain')
  const swap = vi.fn<(params: { quote: SwapQuote }) => Promise<Handle>>()
    .mockImplementationOnce(() => new Promise((resolve) => releases.push(resolve)))
    .mockRejectedValueOnce(failed)
    .mockImplementationOnce(() => new Promise((resolve) => releases.push(resolve)))
  const waitForSwapOutput = vi.fn().mockResolvedValue({})
  const claimSwapOutput = vi.fn().mockImplementation(async ({ handle: item }: { handle: Handle }) => ({
    transactionId: `claim-${item.transactionId}`, amountOut: 100n, amountRemaining: 0n,
  }))

  const pending = submitConcurrentSwaps({ swap, waitForSwapOutput, claimSwapOutput }, [offer, offer, offer])
  expect(swap).toHaveBeenCalledTimes(3)
  expect(waitForSwapOutput).not.toHaveBeenCalled()
  releases[0]!(handle(1))
  releases[1]!(handle(3))
  const results = await pending

  expect(results.map((result) => result.status)).toEqual(['claimed', 'swap-failed', 'claimed'])
  expect(results[1]).toMatchObject({ error: failed })
  expect(claimSwapOutput).toHaveBeenCalledTimes(2)
  expect(swap.mock.calls).toEqual([[{ quote: offer }], [{ quote: offer }], [{ quote: offer }]])
})

describe('claim recovery', () => {
  it.each(['wait', 'claim'])('retains a handle after %s failure without resubmitting or abandoning other claims', async (phase) => {
    let id = 0
    const swap = vi.fn().mockImplementation(async () => handle(++id))
    const failure = new Error('confirmation timed out')
    const waitForSwapOutput = vi.fn().mockImplementation(async ({ handle: item }: { handle: Handle }) => {
      if (phase === 'wait' && item.transactionId === 'swap-1') throw failure
      return {}
    })
    const claimSwapOutput = vi.fn().mockImplementation(async ({ handle: item }: { handle: Handle }) => {
      if (phase === 'claim' && item.transactionId === 'swap-1') throw failure
      return { transactionId: `claim-${item.transactionId}`, amountOut: 80n, amountRemaining: 20n }
    })

    const results = await submitConcurrentSwaps({ swap, waitForSwapOutput, claimSwapOutput }, [offer, offer])
    expect(results[0]).toMatchObject({ status: 'claim-failed', handle: handle(1), error: failure })
    expect(results[1]).toMatchObject({ status: 'claimed', claim: { amountOut: 80n, amountRemaining: 20n } })
    expect(swap).toHaveBeenCalledTimes(2)
    expect(waitForSwapOutput).toHaveBeenCalledWith({ handle: handle(1), timeout: 600_000, pollingInterval: 3_000 })
    expect(claimSwapOutput).toHaveBeenCalledTimes(phase === 'wait' ? 1 : 2)
  })
})

// Validate entry-point guards in a separate process: importing the module in a
// unit test must not hide an accidental CLI execution or missing-key fallback.
describe('concurrent-swaps command', () => {
  const script = fileURLToPath(new URL('./concurrent-swaps.ts', import.meta.url))
  it.each([
    { args: ['--help'], status: 0, message: 'without flags to preview' },
    { args: ['--execut'], status: 1, message: 'Usage:' },
    { args: [], status: 1, message: 'Set VEIL_E2E_PRIVATE_KEY' },
  ])('validates arguments before loading an account: $args', ({ args, status, message }) => {
    const result = spawnSync('pnpm', ['exec', 'tsx', script, ...args], {
      encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, VEIL_E2E_PRIVATE_KEY: '' },
    })
    expect(result.status, result.stderr).toBe(status)
    expect(result.stdout + result.stderr).toContain(message)
  }, 20_000)
})
