import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import type { SwapHandle } from '../../../src/actions/swap/swap.js'
import { claimSwapOutput } from '../../../src/actions/swap/claimSwapOutput.js'
import { clearRouteCache, programToTokenId } from '../../../src/utils/routing.js'

vi.mock('@provablehq/veil-core', async (original) => ({
  ...await original<typeof import('@provablehq/veil-core')>(),
  executeContract: vi.fn(async () => ({ transactionId: 'at1claim' })),
  writeContract: vi.fn(async () => 'at1wallet'),
}))
import { executeContract, writeContract } from '@provablehq/veil-core'

const id = programToTokenId
const handle: SwapHandle = {
  swapId: '9field', blindingFactor: '1field', blindedAddress: 'aleo1recipient',
  tokenInId: id('stale_in'), tokenOutId: id('stale_out'),
  poolKey: '1field', amountIn: 10n, transactionId: 'at1swap', program: 'custom_dex.aleo',
}
function fixture(wrapped: boolean, wallet = false, remaining = 2n) {
  const request = vi.fn(async ({ method, params }: any) => {
    if (method === 'getProgram') {
      return params.programId === 'custom_router.aleo' || params.programId === handle.program
        ? 'import dependency.aleo;\nprogram custom.aleo;'
        : `program ${params.programId};`
    }
    if (params.mapping === 'swap_outputs') return `{ recipient: aleo1recipient, caller: aleo1recipient, token_in: ${id('input')}, token_out: ${id('output')}, amount_out: 8u128, amount_remaining: ${remaining}u128 }`
    if (params.mapping === 'from_wrapper_token_id') return wrapped ? id('underlying') : null
    throw new Error(`Unexpected request ${method}`)
  })
  const client = { account: { type: wallet ? 'rpc' : 'local', address: 'aleo1recipient' }, request } as unknown as Client
  return { client, request }
}
beforeEach(() => { vi.clearAllMocks(); clearRouteCache() })
describe('claim import resolution', () => {
  it('uses chain token identities and the core override rather than stale handle token metadata', async () => {
    const { client, request } = fixture(false)
    await claimSwapOutput(client, { handle })
    expect(vi.mocked(executeContract).mock.calls[0]![1].imports).toEqual({
      'input.aleo': 'program input.aleo;', 'output.aleo': 'program output.aleo;',
      'dependency.aleo': 'program dependency.aleo;',
    })
    expect(request.mock.calls.filter(([r]) => r.method === 'getProgram').map(([r]) => r.params.programId))
      .toEqual(['output.aleo', 'input.aleo', 'custom_dex.aleo', 'dependency.aleo'])
  })
  it.each([0n, 2n])('resolves wrapper, underlying, and custom router dependencies for remainder %s', async (remaining) => {
    const { client } = fixture(true, false, remaining)
    await claimSwapOutput(client, { handle, routerProgram: 'custom_router.aleo' })
    expect(vi.mocked(executeContract).mock.calls[0]![1]).toMatchObject({
      program: 'custom_router.aleo',
      imports: { 'input.aleo': 'program input.aleo;', 'output.aleo': 'program output.aleo;',
        'underlying.aleo': 'program underlying.aleo;', 'dependency.aleo': 'program dependency.aleo;' },
    })
  })
  it('passes resolved program names to wallet signers', async () => {
    const { client } = fixture(false, true)
    await claimSwapOutput(client, { handle })
    expect(vi.mocked(writeContract).mock.calls[0]![1].imports).toEqual(['output.aleo', 'input.aleo', 'dependency.aleo'])
  })
  it('honors explicit imports without fetching any program sources', async () => {
    const { client, request } = fixture(false)
    const imports = { 'cached.aleo': 'program cached.aleo;' }
    await claimSwapOutput(client, { handle, imports })
    expect(vi.mocked(executeContract).mock.calls[0]![1].imports).toBe(imports)
    expect(request.mock.calls.some(([r]) => r.method === 'getProgram')).toBe(false)
  })
  it('does not submit a claim if fetching its sources fails', async () => {
    const { client, request } = fixture(false)
    const original = request.getMockImplementation()!
    request.mockImplementation(async (req) => {
      if (req.method === 'getProgram') throw new Error('source unavailable')
      return original(req)
    })
    await expect(claimSwapOutput(client, { handle })).rejects.toThrow('source unavailable')
    expect(executeContract).not.toHaveBeenCalled()
  })
})
