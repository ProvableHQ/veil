import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/session.js', () => ({ loadSession: vi.fn(), formatAmount: (n: bigint) => String(n) }))
vi.mock('../src/shared.js', async (original) => ({
  ...await original<typeof import('../src/shared.js')>(),
  run: async (fn: () => Promise<void>) => fn(),
  step: vi.fn(), done: vi.fn(), output: vi.fn(),
}))
import { loadSession } from '../src/session.js'
import { output } from '../src/shared.js'
import { main as swapMain } from '../src/commands/swap.js'
import { main as concurrentMain } from '../src/commands/swap-concurrent.js'

const token = { id: '1field', symbol: 'A', decimals: 6, ammTokenProgram: 'a.aleo' }
const offer = { version: 1, network: 'testnet', program: 'shield_swap.aleo', from: token, to: { ...token, id: '2field', symbol: 'B' }, amountIn: 1000000n, expectedOut: 2000000n, minOut: 1990000n, slippageBps: 50, hops: [{ poolKey: '3field', tokenInId: '1field', tokenOutId: '2field' }], quotedAt: 1, expiresAt: 60001, protocolRevision: 1 }
function session() {
  const client = {
    tokenData: vi.fn(async (name: string) => name === 'B' ? offer.to : token),
    resolveDexImports: vi.fn(async () => ({ 'a.aleo': 'program a.aleo;' })),
    getBalances: vi.fn(async () => ({ '1field': { private: 2000000n }, '2field': { private: 2000000n } })),
    quote: vi.fn(async (p: any) => p.from === '2field' ? { ...offer, from: offer.to, to: token } : offer),
    swap: vi.fn(async () => ({ transactionId: 'at1', tokenInId: token.id, tokenOutId: offer.to.id })),
  }
  vi.mocked(loadSession).mockResolvedValue({ client, network: 'testnet' } as any)
  return client
}
beforeEach(() => vi.clearAllMocks())
describe('CLI quote handoff', () => {
  it('dry-runs a swap without spending and prints the quoted floor', async () => {
    const client = session()
    await swapMain(['--from', 'A', '--to', 'B', '--amount', '1', '--json'])
    expect(client.swap).not.toHaveBeenCalled()
    expect(vi.mocked(output).mock.calls[0]![0]).toMatchObject({ submitted: false, quote: { minOut: 1990000n } })
  })
  it('passes the accepted quote unchanged when execution is requested', async () => {
    const client = session()
    await swapMain(['--from', 'A', '--to', 'B', '--amount', '1', '--execute', '--no-claim', '--json'])
    expect(client.swap).toHaveBeenCalledWith({ quote: offer, imports: { 'a.aleo': 'program a.aleo;' } })
  })
  it('dry-runs concurrent swaps without spending', async () => {
    const client = session()
    await concurrentMain(['--swap', 'A:B:1', '--swap', 'B:A:1', '--json'])
    expect(client.quote).toHaveBeenCalledTimes(2)
    expect(client.swap).not.toHaveBeenCalled()
  })
})
