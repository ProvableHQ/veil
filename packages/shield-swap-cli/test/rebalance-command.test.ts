import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMMANDS } from '../src/registry.js'
import { loadSession } from '../src/session.js'
import { setJsonMode } from '../src/shared.js'

vi.mock('../src/session.js', async original => ({ ...await original<object>(), loadSession: vi.fn() }))
let output: string[], plans: Array<{ method: string; params: any }>, submissions: Array<{ method: string; params: any }>
let previousExitCode: typeof process.exitCode
const common = ['--pool', '1field', '--position', '2field', '--tick-lower', '-400', '--tick-upper', '400', '--json']
const bounded = ['--amount0-desired', '10000', '--amount1-desired', '12000', '--amount0-min', '9000']
beforeEach(() => {
  output = []; plans = []; submissions = []
  previousExitCode = process.exitCode; process.exitCode = undefined
  setJsonMode(true)
  vi.spyOn(console, 'log').mockImplementation(value => { output.push(String(value)) })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process, 'exit').mockImplementation(code => { throw new Error(`EXIT:${code}`) })
  const client: Record<string, unknown> = {
    getPool: async () => ({ token0: '3field', token1: '4field' }),
    tokenData: async (id: string) => ({ id, symbol: id === '3field' ? 'A' : 'B', decimals: 0, ammTokenProgram: 'token.aleo' }),
    resolveDexImports: async () => ({ 'token.aleo': 'program token.aleo;' }),
  }
  for (const suffix of ['ExactAmounts', 'ToLiquidity', 'FromAmounts']) {
    client[`planRebalance${suffix}`] = async (params: any) => {
      plans.push({ method: suffix, params })
      return { ...params, liquidityTarget: suffix === 'FromAmounts' ? 0n : params.liquidityTarget,
        oldLiquidity: 1000n, recovered0: 11000n, recovered1: 13000n, required0: 10000n, required1: 12000n,
        funded0: params.funded0 ?? 0n, funded1: 0n, refund0: 0n, refund1: 0n,
        ...(suffix === 'FromAmounts' ? { estimatedLiquidity: 999n } : {}) }
    }
    client[`rebalancePosition${suffix}`] = async (params: any) => {
      submissions.push({ method: suffix, params })
      return { transactionId: 'at1fixture', positionTokenId: '9field', plan: params }
    }
  }
  vi.mocked(loadSession).mockResolvedValue({ client, network: 'testnet' } as never)
})
afterEach(() => {
  setJsonMode(false); process.exitCode = previousExitCode
  vi.restoreAllMocks(); vi.resetAllMocks()
})
async function rebalance(argv: string[]) {
  expect(COMMANDS.rebalance).toBeDefined()
  await (await COMMANDS.rebalance!.load()).main(argv)
}
describe('rebalance command', () => {
  it.each([
    ['exact-amounts', 'ExactAmounts', ['--liquidity-target', '1000']],
    ['to-liquidity', 'ToLiquidity', ['--liquidity-target', '1000', ...bounded]],
    ['from-amounts', 'FromAmounts', bounded],
  ] as const)('previews %s without signing', async (kind, method, options) => {
    await rebalance([kind, ...common, ...options])
    const result = JSON.parse(output.join('\n'))
    expect(result.submitted).toBe(false)
    expect(result.plan.tickLower).toBe(-400)
    expect(plans[0]!.method).toBe(method)
    expect(submissions).toEqual([])
    if (kind === 'from-amounts') {
      expect(result.plan.liquidityTarget).toBe('0')
      expect(result.plan.estimatedLiquidity).toBe('999')
      expect(plans[0]!.params.amount0Min).toBe(9000n)
    }
  })
  it('submits the prepared constraints once with explicit execution', async () => {
    await rebalance(['from-amounts', ...common, ...bounded, '--funded0', '123', '--execute'])
    expect(submissions).toHaveLength(1)
    expect(submissions[0]).toMatchObject({ method: 'FromAmounts', params: {
      liquidityTarget: 0n, amount0Desired: 10000n, amount0Min: 9000n, funded0: 123n,
      estimatedLiquidity: 999n, imports: { 'token.aleo': 'program token.aleo;' },
    } })
    expect(plans).toHaveLength(1)
    expect(JSON.parse(output.join('\n')).transactionId).toBe('at1fixture')
  })
  it.each([
    ['from-amounts', ...bounded, '--liquidity-target', '1000'],
    ['to-liquidity', ...bounded, '--liquidity-target', '0'],
    ['exact-amounts', '--liquidity-target', '1000', '--amount0-min', '1'],
    ['from-amounts', ...bounded, '--tick-upper', 'NaN'],
    ['from-amounts', ...bounded, '--funded0', '-1'],
  ])('rejects conflicting or malformed options before loading an account: %#', async (...args) => {
    const [kind, ...options] = args
    await expect(rebalance([kind!, ...common, ...options])).rejects.toThrow('EXIT:64')
    expect(loadSession).not.toHaveBeenCalled()
  })
})
