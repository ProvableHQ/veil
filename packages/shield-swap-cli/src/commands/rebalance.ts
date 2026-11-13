import type { RebalancePlan } from '@provablehq/shield-swap-sdk'
import { loadSession } from '../session.js'
import { flags, confirmed, output, reportUsage, run } from '../shared.js'

const USAGE = `shield-swap rebalance <exact-amounts|to-liquidity|from-amounts>

  --pool <field>                pool containing the position
  --position <field>            position token id to close completely
  --tick-lower <integer>        replacement range lower tick
  --tick-upper <integer>        replacement range upper tick
  --liquidity-target <u128>     required for exact-amounts and to-liquidity
  --amount0-desired <u128>      token0 deposit cap; required for flexible calls
  --amount1-desired <u128>      token1 deposit cap; required for flexible calls
  --amount0-min <u128>          minimum token0 consumed; default 0
  --amount1-min <u128>          minimum token1 consumed; default 0
  --funded0 <u128>              fixed additional token0 funding; default 0
  --funded1 <u128>              fixed additional token1 funding; default 0
  --refund0 <u128>              fixed immediate token0 payout; default 0
  --refund1 <u128>              fixed immediate token1 payout; default 0
  --network <testnet|mainnet>   default testnet
  --execute                    submit the displayed plan
  --json                       machine-readable output

All token amounts are RAW integer units in on-chain token0/token1 order.
exact-amounts computes exact deposits, funding, and refunds from its target.
The other calls require both deposit caps; funding and immediate refunds are
fixed before execution, and unused tokens remain collectible on the successor.
from-amounts determines liquidity at execution; its preview is an estimate.
The full old position closes in the same pool. No token swap occurs.`

/**
 * Plans or submits an atomic position rebalance with an explicit guarantee.
 *
 * Reads chain state and prints constraints. Only --execute signs and submits.
 * @param argv Arguments after the rebalance command name.
 * @returns Completion after printing a plan, transaction, or error.
 * @throws For malformed command-line arguments before account initialization.
 * @example
 * await main(['from-amounts', '--pool', '1field', '--position', '2field', '--tick-lower', '-400', '--tick-upper', '400', '--amount0-desired', '10000', '--amount1-desired', '10000'])
 */
export async function main(argv: string[]): Promise<void> {
  const kind = argv[0]
  // Node's argument parser requires a dash-prefixed string value to use '='.
  // Accept the usual '--tick-lower -400' spelling as well.
  const normalized: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if ((arg === '--tick-lower' || arg === '--tick-upper') && /^-\d+$/.test(argv[i + 1] ?? '')) {
      normalized.push(`${arg}=${argv[++i]}`)
    } else normalized.push(arg)
  }
  const args = flags({
    pool: { type: 'string' }, position: { type: 'string' },
    'tick-lower': { type: 'string' }, 'tick-upper': { type: 'string' },
    'liquidity-target': { type: 'string' },
    'amount0-desired': { type: 'string' }, 'amount1-desired': { type: 'string' },
    'amount0-min': { type: 'string' }, 'amount1-min': { type: 'string' },
    funded0: { type: 'string' }, funded1: { type: 'string' },
    refund0: { type: 'string' }, refund1: { type: 'string' },
  }, USAGE, kind?.startsWith('-') ? normalized : normalized.slice(1))
  const invalid = (message: string): never => reportUsage(message, USAGE, argv)
  if (!['exact-amounts', 'to-liquidity', 'from-amounts'].includes(kind!)) invalid('Choose exact-amounts, to-liquidity, or from-amounts')
  for (const key of ['pool', 'position'] as const) {
    if (typeof args[key] !== 'string' || !/^\d+field$/.test(args[key] as string)) invalid(`--${key} requires a field literal`)
  }
  const tick = (key: 'tick-lower' | 'tick-upper'): number => {
    const value = args[key]
    if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return invalid(`--${key} requires an integer`)
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < -400000 || parsed > 400000) return invalid(`--${key} must be between -400000 and 400000`)
    return parsed
  }
  const base = { poolKey: args.pool as string, positionTokenId: args.position as string,
    tickLower: tick('tick-lower'), tickUpper: tick('tick-upper') }
  if (base.tickLower >= base.tickUpper) invalid('The lower tick must be less than the upper tick')
  const amounts: Record<string, bigint> = {}
  const amountKeys = ['liquidity-target', 'amount0-desired', 'amount1-desired', 'amount0-min', 'amount1-min', 'funded0', 'funded1', 'refund0', 'refund1'] as const
  for (const key of amountKeys) {
    const value = args[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || !/^\d+$/.test(value) || BigInt(value) >= 1n << 128n) invalid(`--${key} requires a u128 raw integer amount`)
    amounts[key] = BigInt(value as string)
  }
  const target = amounts['liquidity-target']
  if (kind === 'from-amounts' && target !== undefined) invalid('from-amounts does not accept --liquidity-target')
  if (kind !== 'from-amounts' && (target === undefined || target === 0n)) invalid('--liquidity-target must be positive')
  if (kind === 'exact-amounts' && amountKeys.slice(1).some(key => args[key] !== undefined)) {
    invalid('exact-amounts derives its deposits and transfers; only supply --liquidity-target')
  }
  if (kind !== 'exact-amounts' && (amounts['amount0-desired'] === undefined || amounts['amount1-desired'] === undefined)) {
    invalid('Both --amount0-desired and --amount1-desired are required')
  }
  const bounded = { ...base, amount0Desired: amounts['amount0-desired']!, amount1Desired: amounts['amount1-desired']!,
    amount0Min: amounts['amount0-min'] ?? 0n, amount1Min: amounts['amount1-min'] ?? 0n,
    funded0: amounts.funded0 ?? 0n, funded1: amounts.funded1 ?? 0n,
    refund0: amounts.refund0 ?? 0n, refund1: amounts.refund1 ?? 0n }

  await run(async () => {
    const { client, network } = await loadSession({ network: args.network as string | undefined })
    const pool = await client.getPool({ poolKey: base.poolKey })
    if (!pool) throw new Error(`Pool ${base.poolKey} does not exist`)
    const [token0, token1] = await Promise.all([client.tokenData(pool.token0), client.tokenData(pool.token1)])
    const plan: RebalancePlan = kind === 'exact-amounts'
      ? await client.planRebalanceExactAmounts({ ...base, liquidityTarget: target! })
      : kind === 'to-liquidity'
        ? await client.planRebalanceToLiquidity({ ...bounded, liquidityTarget: target! })
        : await client.planRebalanceFromAmounts(bounded)
    const execute = confirmed({ execute: args.execute, network, plan: [
      ['guarantee', kind!], ['position', base.positionTokenId],
      ['range', `${plan.tickLower} to ${plan.tickUpper}`],
      [plan.liquidityTarget === 0n ? 'estimated liquidity' : 'exact liquidity', String(plan.estimatedLiquidity ?? plan.liquidityTarget)],
      ['token order', `token0 ${token0.symbol}; token1 ${token1.symbol}; all amounts below are raw units`],
      ['deposit caps', `${plan.amount0Desired ?? plan.required0} / ${plan.amount1Desired ?? plan.required1}`],
      ['deposit minimums', `${plan.amount0Min ?? plan.required0} / ${plan.amount1Min ?? plan.required1}`],
      ['fixed funding', `${plan.funded0} / ${plan.funded1}`],
      ['fixed refunds', `${plan.refund0} / ${plan.refund1}`],
      ['surplus', kind === 'exact-amounts' ? 'Included in fixed refunds' : 'Remains collectible on the successor'],
    ] })
    if (!execute) {
      output({ network, submitted: false, kind, plan }, () => {})
      return
    }
    const imports = await client.resolveDexImports({
      tokenPrograms: [token0.ammTokenProgram, token1.ammTokenProgram].filter((program): program is string => !!program),
    })
    const result = kind === 'exact-amounts'
      ? await client.rebalancePositionExactAmounts({ ...plan, imports })
      : kind === 'to-liquidity'
        ? await client.rebalancePositionToLiquidity({ ...plan, amount0Desired: bounded.amount0Desired, amount1Desired: bounded.amount1Desired, imports })
        : await client.rebalancePositionFromAmounts({ ...plan, liquidityTarget: 0n, amount0Desired: bounded.amount0Desired, amount1Desired: bounded.amount1Desired, imports })
    output({ network, submitted: true, kind, ...result }, data => {
      console.log(`Rebalance submitted: ${data.transactionId}`)
      console.log(`Successor position: ${data.positionTokenId ?? 'read from the confirmed transaction'}`)
    })
  })
}
