import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/session.js', async original => ({
  ...await original<typeof import('../src/session.js')>(),
  loadSession: vi.fn(), formatAmount: (amount: bigint) => String(amount), pollUntil: async () => true,
}))
vi.mock('../src/shared.js', async (original) => ({
  ...await original<typeof import('../src/shared.js')>(),
  run: async (fn: () => Promise<void>) => fn(), step: vi.fn(), done: vi.fn(), output: vi.fn(),
}))
import { loadSession } from '../src/session.js'
import { output } from '../src/shared.js'
import { main as collectMain } from '../src/commands/collect.js'
import { main as lifecycleMain } from '../src/commands/liquidity-e2e.js'
import { main as mintMain } from '../src/commands/mint.js'
import { main as liquidityMain } from '../src/commands/liquidity.js'
import { main as historyMain } from '../src/commands/swap-history.js'

function session() {
  const owned = {
    positionTokenId: '3field', poolKey: '4field', token0Id: '1field', token1Id: '2field', withdrawal: 'aleo1cold',
    record: { tag: 'position' }, tickLower: -60, tickUpper: 60,
    state: { tokensOwed0: 10n, tokensOwed1: 20n, uncollectedFees0: 11n, uncollectedFees1: 21n, liquidity: 100n },
  }
  const preview = { liquidity: 100n, tickLower: -60, tickUpper: 60, tickCurrent: 0, inRange: true, amount0: 10n, amount1: 20n, fee: 3000, tickSpacing: 60, feeTierSpacing: 60 }
  const client = {
    listTokens: async () => [
      { id: '1field', symbol: 'A', decimals: 6, ammTokenProgram: 'a.aleo' },
      { id: '2field', symbol: 'B', decimals: 6, ammTokenProgram: 'b.aleo' },
    ],
    getOwnedPositions: async () => [owned], getOwnedPosition: async () => owned,
    getBalances: async () => ({ '1field': { private: 1000000n }, '2field': { private: 1000000n } }),
    getPool: async () => ({ token0: '1field', token1: '2field' }),
    getTradeControls: async () => ({ tradeable: true }), previewMint: async () => preview,
    resolveDexImports: vi.fn(async () => ({})),
    collect: vi.fn(async () => ({ transactionId: 'at1test' })), mint: vi.fn(), increaseLiquidity: vi.fn(), claimSwapOutput: vi.fn(),
    getUnclaimedSwaps: async () => ({ unresolvable: [], totals: {}, swaps: [{ swapId: '9field', claimable: true, output: { token_in: '1field', token_out: '2field', amount_out: 10n, amount_remaining: 0n } }] }),
    isBlindedAddressUsed: async () => false,
  }
  // Public SDK test vectors; all chain reads and writes are mocked.
  vi.mocked(loadSession).mockResolvedValue({
    client, network: 'testnet', blindedIdentities: { load: async () => [] },
    account: {
      address: 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px',
      viewKey: 'AViewKey1nPQW8P83ajkMBHQwYjbUfjGHVSkBQ5wctpJJmQvW1SyZ',
    },
  } as never)
  return client
}
beforeEach(() => vi.clearAllMocks())
describe('collection proof subjects', () => {
  it.each([
    ['mint', mintMain, ['--pool', '4field', '--percent', '10', '--json']],
    ['increase', liquidityMain, ['--position', '3field', '--increase', '--percent', '10', '--json']],
    ['claim', historyMain, ['--claim', '--no-search', '--window', '1', '--json']],
  ] as const)('dry-runs %s without invoking proof-bearing writes', async (_name, main, args) => {
    const client = session()
    await main([...args])
    expect(client.mint).not.toHaveBeenCalled()
    expect(client.increaseLiquidity).not.toHaveBeenCalled()
    expect(client.claimSwapOutput).not.toHaveBeenCalled()
    expect(client.resolveDexImports).not.toHaveBeenCalled()
  })
  it('dry-runs collect without submitting or loading proving imports', async () => {
    const client = session()
    await collectMain(['--json'])
    expect(client.collect).not.toHaveBeenCalled()
    expect(client.resolveDexImports).not.toHaveBeenCalled()
    expect(vi.mocked(output).mock.calls[0]![0]).toMatchObject({ submitted: false })
  })
  it('forwards the position withdrawal subject when collecting', async () => {
    const client = session()
    await collectMain(['--execute', '--json'])
    expect(client.collect).toHaveBeenCalledWith(expect.objectContaining({ withdrawalAddress: 'aleo1cold' }))
  })
  it('dry-runs the full liquidity command without submitting', async () => {
    const client = session()
    await lifecycleMain(['--pool', '4field', '--json'])
    expect(client.mint).not.toHaveBeenCalled()
    expect(client.collect).not.toHaveBeenCalled()
    expect(client.resolveDexImports).not.toHaveBeenCalled()
    expect(vi.mocked(output).mock.calls[0]![0]).toMatchObject({ submitted: false, poolKey: '4field' })
  })
})
