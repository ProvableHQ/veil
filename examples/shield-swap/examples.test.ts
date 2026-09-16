import { describe, it } from 'vitest'
import { poolState } from './pool-state.js'
import { quote } from './quote.js'
import { balances } from './balances.js'
import { swapHistory } from './swap-history.js'
import { swap } from './swap.js'
import { mint } from './mint.js'
import { liquidity } from './liquidity.js'
import { rebalance } from './rebalance.js'
import { trackLiquidityPosition } from './lp-fill-tracker.js'

/**
 * Runs every example against live testnet, so a rename in the SDK or the API
 * breaks here rather than in a reader's terminal. The examples themselves stay
 * free of test scaffolding — what a reader copies is what runs.
 *
 * Three tiers, gated by what each needs:
 *
 *   VEIL_INTEGRATION=1                        pool and token reads
 *   + VEIL_E2E_PRIVATE_KEY,                   reads that need an account,
 *     ALEO_CONSUMER_ID, ALEO_DPS_API_KEY      but spend nothing
 *   + VEIL_EXAMPLES_SPEND=1                   the ones that move funds
 */
const READS = process.env.VEIL_INTEGRATION === '1'
const KEYED =
  READS &&
  !!process.env.VEIL_E2E_PRIVATE_KEY &&
  !!process.env.ALEO_CONSUMER_ID &&
  !!process.env.ALEO_DPS_API_KEY
// Opt in separately: the credentials above are enough to read, and a run that
// spends should be asked for rather than inferred from them being present.
const SPENDS = KEYED && process.env.VEIL_EXAMPLES_SPEND === '1'
const POSITION = READS && !!process.env.VEIL_E2E_PRIVATE_KEY && !!process.env.VEIL_POSITION_TOKEN_ID

const MINUTES = 600_000

describe.runIf(READS)('examples: reads that need no account', () => {
  it('pool-state', () => poolState(), MINUTES)
})

describe.runIf(KEYED)('examples: reads that need an account', () => {
  it('quote', () => quote(), MINUTES)
  it('balances', () => balances(), MINUTES)
  it('swap-history', () => swapHistory(), MINUTES)
})

describe.runIf(POSITION)('examples: reads that need a position', () => {
  it('lp-fill-tracker', () =>
    trackLiquidityPosition({
      positionTokenId: process.env.VEIL_POSITION_TOKEN_ID!,
      network: 'testnet',
      watch: false,
    }), MINUTES)
})

describe.runIf(SPENDS)('examples: these move funds', () => {
  it('swap', () => swap(), MINUTES)
  it('mint', () => mint(), MINUTES)
  it('liquidity', () => liquidity(), MINUTES)
  it('rebalance', () => rebalance(), MINUTES)
})
