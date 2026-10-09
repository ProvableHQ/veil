import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { memoryRecordInventoryStore, recordActions, type Client } from '@provablehq/veil-core'
import { planInventory } from '../../src/actions/inventory/planInventory.js'
import { selectTokenRecord } from '../../src/utils/records.js'
import type { ApiClient } from '../../src/api/client.js'

const account = { type: 'rpc', address: 'aleo1owner' }
const scope = JSON.stringify(['testnet', account.address])
const record = (program: string, amount: bigint, nonce: number) => ({ programName: program, recordName: program === 'credits.aleo' ? 'credits' : 'Token', spent: false, tag: `${nonce}field`,
  recordPlaintext: `{ owner: aleo1owner.private, ${program === 'credits.aleo' ? 'microcredits' : 'amount'}: ${amount}${program === 'credits.aleo' ? 'u64' : 'u128'}.private, _nonce: ${nonce}group.public }` })

describe('Shield Swap inventory', () => {
  it.each(['credits.aleo', 'test_usdcx_stablecoin.aleo'])('plans the underlying %s program, not its AMM wrapper', async (program) => {
    const api = { getTokens: async () => ({ data: [{ address: '1field', symbol: 'ASSET', decimals: 6,
      amm_token_program: 'wrapper.aleo', underlying_program: program }] }) } as unknown as ApiClient
    const request = vi.fn(async ({ method, params }) => {
      if (method === 'getProgram') return readFileSync(new URL(`../../../core/test/fixtures/programs/${program}`, import.meta.url), 'utf8')
      if (method === 'requestRecords') { expect(params.program).toBe(program); return [record(program, 1_030_000n, 1)] }
      throw new Error('Planning must not submit')
    })
    const client = { account, transport: { config: { network: 'testnet' } }, request } as unknown as Client
    const plan = await planInventory(client, { api, token: 'ASSET', target: { records: 4, distribution: 'balanced' } })
    expect(plan.asset).toEqual({ program, standard: program === 'credits.aleo' ? 'credits' : 'arc22' })
    expect(plan.steps).toHaveLength(3)
  })
  it('keeps reserved inventory out of trading record selection', async () => {
    const program = 'test_arc20_eth.aleo'
    const store = memoryRecordInventoryStore()
    await store.acquire({ scope, program, function: 'join', records: ['1group'], status: 'reserved', accountType: 'local', createdAt: Date.now() })
    const base = { account, transport: { config: { network: 'testnet' } }, request: async () => [record(program, 500n, 1), record(program, 700n, 2)] } as unknown as Client
    const client = Object.assign(base, recordActions({ store })(base))
    expect((await selectTokenRecord(client, { program, minAmount: 400n })).amount).toBe(700n)
  })
  it('uses the configured router for the resolved underlying token inventory', async () => {
    const program = 'test_arc20_eth.aleo'
    const api = { getTokens: async () => ({ data: [{ address: '1field', symbol: 'ASSET', decimals: 6,
      amm_token_program: 'wrapper.aleo', underlying_program: program }] }) } as unknown as ApiClient
    const base = { account, transport: { config: { network: 'testnet' } }, request: async ({ method }: any) => {
      if (method === 'getProgram') return readFileSync(new URL(`../../../core/test/fixtures/programs/${program}`, import.meta.url), 'utf8')
      if (method === 'requestRecords') return Array.from({ length: 16 }, (_, i) => record(program, 100n, i + 1))
      throw new Error('Planning must not submit')
    } } as unknown as Client
    const tokenJoin = { program: 'test_aj_arc20_2_15.aleo' }
    const client = Object.assign(base, recordActions({ tokenJoin })(base))
    const plan = await planInventory(client, { api, token: 'ASSET', target: { records: 1 }, maxTransactions: 2 })
    expect(plan.asset.program).toBe(program)
    expect(plan.tokenJoin).toEqual(tokenJoin)
    expect(plan.steps.map((step) => step.inputs.length)).toEqual([15, 2])
  })
})
