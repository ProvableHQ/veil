import { describe, expect, it } from 'vitest'
import { createClient, createPublicClient, http, type RecordAsset } from '../../src/index.js'
import { validateAsset } from '../../src/actions/records/internal.js'
import { getRecordJoinPrograms, validateRecordJoinFunction } from '../../src/inventory/joinPrograms.js'

/**
 * Checks inventory defaults and helper discovery against deployed testnet code.
 * Reads through the real HTTP transport; no account, scanner, or transaction is needed.
 * Run with VEIL_INTEGRATION=1 pnpm vitest run packages/core/test/integration/recordInventory.integration.test.ts.
 */
const RUN = process.env.VEIL_INTEGRATION === '1'
const client = createPublicClient({ transport: http('https://edge.provable.com/api/v2', { network: 'testnet' }) })

const assets = [
  { program: 'credits.aleo', recordName: 'credits', amountField: 'microcredits', amountType: 'u64',
    helpers: ['autojoin_credits_2_10.aleo', 'autojoin_credits_11_14.aleo', 'autojoin_credits_15_16.aleo'], max: 16 },
  { program: 'test_usdcx_stablecoin.aleo', recordName: 'Token', amountField: 'amount', amountType: 'u128',
    helpers: ['aj_test_usdcx_stablecoin_2_10.aleo', 'aj_test_usdcx_stablecoin_11_14.aleo', 'aj_test_usdcx_stablecoin_15_16.aleo'], max: 16 },
  { program: 'test_arc20_eth.aleo', recordName: 'Token', amountField: 'amount', amountType: 'u128',
    helpers: ['test_aj_arc20_2_15.aleo'], max: 15 },
] as const

describe.runIf(RUN)('live inventory program interfaces', () => {
  it.each(assets)('resolves $program without a standard and finds usable batch functions', async expected => {
    // A regression in default selection or external/dynamic ABI parsing must
    // fail against deployed code, even if local program fixtures still pass.
    const asset: RecordAsset = { program: expected.program }
    const resolved = await validateAsset(client, asset)
    expect(resolved.asset).toMatchObject({ program: expected.program, recordName: expected.recordName,
      amountField: expected.amountField, amountType: expected.amountType })
    const helpers = await getRecordJoinPrograms(client, resolved.asset)
    expect(helpers.map(helper => helper.program)).toEqual(expected.helpers)
    expect([...new Set(helpers.flatMap(helper => helper.counts))].sort((a, b) => a - b))
      .toEqual(Array.from({ length: expected.max - 1 }, (_, index) => index + 2))
    // Validate every supported arity through the spending validator. Interior
    // functions must be compatible too, not only the deployment boundaries.
    for (const helper of helpers) {
      for (const count of helper.counts) await validateRecordJoinFunction(client, resolved.asset, helper, count)
    }
  }, 120_000)

  it.each(assets)('disables deployed helpers for $program when native joins are configured', async expected => {
    const native = createClient({
      transport: http('https://edge.provable.com/api/v2', { network: 'testnet' }),
      recordManagement: { enabled: false, tokenJoin: false },
    })
    const resolved = await validateAsset(native, { program: expected.program })
    expect(await getRecordJoinPrograms(native, resolved.asset)).toEqual([])
  }, 120_000)

  it('rejects a static helper for another asset and a count outside its deployed range', async () => {
    const usdcx = await validateAsset(client, { program: 'test_usdcx_stablecoin.aleo' })
    const eth = await validateAsset(client, { program: 'test_arc20_eth.aleo' })
    const [helper] = await getRecordJoinPrograms(client, usdcx.asset)
    expect(helper).toBeDefined()
    await expect(validateRecordJoinFunction(client, eth.asset, helper!, 3)).rejects.toThrow('incompatible function signature')
    await expect(validateRecordJoinFunction(client, usdcx.asset, helper!, 11)).rejects.toThrow('outside the join helper limits')
  }, 120_000)

  it('accepts explicit record/field overrides and rejects an undeclared balance', async () => {
    const explicit = await validateAsset(client, { program: 'test_usdcx_stablecoin.aleo', recordName: 'Token', amountField: 'amount' })
    expect(explicit.asset.amountType).toBe('u128')
    await expect(validateAsset(client, { program: 'test_usdcx_stablecoin.aleo', amountField: 'not_a_balance' }))
      .rejects.toThrow('amount field')
  }, 120_000)
})
