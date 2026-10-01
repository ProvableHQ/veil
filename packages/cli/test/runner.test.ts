import { describe, expect, it, vi, beforeEach } from 'vitest'
import { parseInventoryConfig } from '../src/config.js'
import { runInventoryCycle } from '../src/runner.js'
import { memoryRecordInventoryStore, getRecordInventory, planRecordInventory, rebalanceRecordInventory, reconcileRecordInventory } from '@provablehq/veil-core'
vi.mock('@provablehq/veil-core', async (load) => ({ ...await load<object>(),
  getRecordInventory: vi.fn(), planRecordInventory: vi.fn(), rebalanceRecordInventory: vi.fn(), reconcileRecordInventory: vi.fn() }))
const policy = { asset: { program: 'credits.aleo', standard: 'credits' }, target: { records: 4, minRecordAmount: '100' } }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(reconcileRecordInventory).mockResolvedValue([]) })

describe('inventory application policies', () => {
  it('validates precision, networks, duplicates, intervals, and hysteresis', () => {
    expect(parseInventoryConfig({ policies: [policy] }).policies[0]?.target.minRecordAmount).toBe(100n)
    expect(() => parseInventoryConfig({ policies: [{ ...policy, target: { records: 4, minRecordAmount: 100 } }] })).toThrow('decimal strings')
    expect(() => parseInventoryConfig({ network: 'devnet' })).toThrow('Network')
    expect(() => parseInventoryConfig({ intervalMs: 0 })).toThrow()
    expect(() => parseInventoryConfig({ policies: [policy, policy] })).toThrow('Duplicate')
    expect(() => parseInventoryConfig({ policies: [{ ...policy, countRange: [5, 7] }] })).toThrow('countRange')
    expect(() => parseInventoryConfig({ privateKey: 'do-not-store' })).toThrow('privateKeyEnv')
  })
  it('waits for trading reservations instead of planning competing work', async () => {
    vi.mocked(reconcileRecordInventory).mockResolvedValue([{ program: 'swap.aleo', status: 'submitted' }] as any)
    const results = await runInventoryCycle({} as any, parseInventoryConfig({ policies: [policy] }), memoryRecordInventoryStore(), 'scope')
    expect(results[0]?.status).toBe('waiting')
    expect(getRecordInventory).not.toHaveBeenCalled()
  })
  it('uses the acceptable count range without reshaping every trade', async () => {
    vi.mocked(getRecordInventory).mockResolvedValue({ available: Array.from({ length: 3 }, () => ({ amount: 100n })), reserved: [], balance: 300n } as any)
    const result = await runInventoryCycle({} as any, parseInventoryConfig({ policies: [{ ...policy, countRange: [3, 6] }] }), memoryRecordInventoryStore(), 'scope')
    expect(result[0]?.status).toBe('satisfied')
    expect(planRecordInventory).not.toHaveBeenCalled()
  })
  it('includes intrinsic credits deductions in the rolling fee budget', async () => {
    vi.mocked(getRecordInventory).mockResolvedValue({ available: [], reserved: [], balance: 100n })
    vi.mocked(planRecordInventory).mockResolvedValue({ steps: [{}], deduction: 30_000n } as any)
    const result = await runInventoryCycle({} as any, parseInventoryConfig({ policies: [policy], maxDailyFeeMicrocredits: '29999' }), memoryRecordInventoryStore(), 'scope')
    expect(result[0]?.status).toBe('budget')
    expect(rebalanceRecordInventory).not.toHaveBeenCalled()
  })
  it('stops the cycle after an uncertain submission', async () => {
    vi.mocked(getRecordInventory).mockResolvedValue({ available: [], reserved: [], balance: 100n })
    vi.mocked(planRecordInventory).mockResolvedValue({ steps: [{}], deduction: 0n } as any)
    vi.mocked(rebalanceRecordInventory).mockResolvedValue({ status: 'interrupted', completedSteps: 0, transactionIds: ['at1unknown'] })
    const config = parseInventoryConfig({ policies: [policy, { ...policy, asset: { program: 'token.aleo', standard: 'arc20' } }] })
    expect(await runInventoryCycle({} as any, config, memoryRecordInventoryStore(), 'scope')).toHaveLength(1)
    expect(rebalanceRecordInventory).toHaveBeenCalledTimes(1)
  })
})
