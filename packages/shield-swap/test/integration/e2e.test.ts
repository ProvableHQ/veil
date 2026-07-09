import { describe, it, expect } from 'vitest'
import { loadNetwork } from '@provablehq/veil-sdk'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { getProgram } from '@provablehq/veil-core'
import { parseTokenRecordInfo } from '../../src/utils/records.js'
import { SwapOutputNotFinalizedError } from '../../src/actions/swap/claimSwapOutput.js'

/**
 * The headline e2e: the private-swap lifecycle against the REAL testnet —
 * airdrop → privatize records → ensure pool → swap → getSwapOutput →
 * claimSwapOutput.
 *
 * Requirements (skipped when absent):
 *   VEIL_INTEGRATION=1
 *   VEIL_E2E_PRIVATE_KEY   funded testnet account (credits for fees)
 *   ALEO_DPS_API_KEY, ALEO_CONSUMER_ID   delegated proving credentials
 * Optional: ALEO_DPS_URL, ALEO_RSS_URL, and VEIL_DEX_PROGRAM to pick the
 * program under test — defaults to shield_swap_v3.aleo.
 */
const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY
const DPS_API_KEY = process.env.ALEO_DPS_API_KEY
const CONSUMER_ID = process.env.ALEO_CONSUMER_ID
const RUN = process.env.VEIL_INTEGRATION === '1' && !!PRIVATE_KEY && !!DPS_API_KEY && !!CONSUMER_ID

const NETWORK_URL = 'https://api.provable.com/v2'
const DPS_URL = process.env.ALEO_DPS_URL ?? 'https://api.provable.com/prove/testnet'
const RSS_URL = process.env.ALEO_RSS_URL ?? 'https://api.provable.com/scanner'
const DEX_PROGRAM = process.env.VEIL_DEX_PROGRAM ?? 'shield_swap_v3.aleo'
const TX_TIMEOUT = 420_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Polls an async predicate up to `tries` times, `ms` apart; true once it holds. */
async function pollUntil(predicate: () => Promise<boolean>, tries: number, ms: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return true
    await sleep(ms)
  }
  return false
}

describe.runIf(RUN)('e2e: private swap + liquidity lifecycle on testnet', async () => {
  const aleo = await loadNetwork('testnet')
  const scanner = aleo.createRemoteScanner({ url: RSS_URL, consumerId: CONSUMER_ID!, apiKey: DPS_API_KEY })
  const { walletClient, account } = aleo.createAleoClient({
    privateKey: PRIVATE_KEY!,
    networkUrl: NETWORK_URL,
    provingMode: 'delegated',
    proverUrl: DPS_URL,
    apiKey: DPS_API_KEY,
    consumerId: CONSUMER_ID,
    records: scanner,
  })
  const client = walletClient.extend(shieldSwapActions({ api: {}, program: DEX_PROGRAM }))

  // Resolved during the run and shared across steps (tests run in order).
  const state: {
    token0?: { address: string; program: string; decimals: number }
    token1?: { address: string; program: string; decimals: number }
    imports?: Record<string, string>
    poolKey?: string
    handle?: Awaited<ReturnType<typeof client.swap>>
  } = {}

  it('funds the account via the async airdrop when balances are empty', async () => {
    const balances = await client.api.getPublicBalances({ user: account.address })
    const empty = balances.data.length === 0 || balances.data.every((b) => BigInt(b.balance ?? 0) === 0n)
    if (empty) {
      const started = await client.api.airdrop(account.address)
      expect(started.job_id).toBeTruthy()
      // Poll until the faucet's per-token transfers settle.
      for (let i = 0; i < 60; i++) {
        const job = await client.api.getAirdropStatus(started.job_id)
        if (job.status === 'completed' || job.status === 'done') break
        await sleep(5000)
      }
    }
    const after = await client.api.getPublicBalances({ user: account.address })
    expect(after.data.length).toBeGreaterThan(0)
  }, TX_TIMEOUT)

  it('picks a token pair and fetches wrapper program sources (dyn-dispatch imports)', async () => {
    // Pick a live pool that satisfies BOTH swap preconditions:
    //   1. the account can fund both tokens — the swap privatizes public balance
    //      into records, so a token the account holds zero of would revert
    //      transfer_public_to_private; and
    //   2. the pool has non-zero liquidity — create_pool does not seed
    //      liquidity, so an empty pool has nothing to swap against and the swap
    //      finalize reverts.
    // Fall back to the first two wrapper tokens on a fresh deployment.
    const pools = await client.api.getPools({ limit: 50 })
    const balances = await client.api.getPublicBalances({ user: account.address })
    const funded = new Set(balances.data.filter((b) => BigInt(b.balance ?? 0) > 0n).map((b) => b.token_id))
    const candidates = pools.data.filter(
      (p) =>
        p.token0_info?.wrapper_program &&
        p.token1_info?.wrapper_program &&
        funded.has(p.token0) &&
        funded.has(p.token1),
    )
    let live: (typeof candidates)[number] | undefined
    for (const p of candidates) {
      const slot = await client.getSlot({ poolKey: p.key })
      if (slot && slot.liquidity > 0n) {
        live = p
        break
      }
    }
    if (live?.token0_info?.wrapper_program && live?.token1_info?.wrapper_program) {
      state.token0 = { address: live.token0, program: live.token0_info.wrapper_program, decimals: live.token0_info.decimals }
      state.token1 = { address: live.token1, program: live.token1_info.wrapper_program, decimals: live.token1_info.decimals }
      // Lock in THIS pool — the pair can have several pools across fee tiers and
      // most have zero liquidity; only this one was verified to have depth.
      state.poolKey = live.key
    } else {
      const tokens = await client.api.getTokens()
      const withWrappers = tokens.data.filter((t) => t.wrapper_program)
      expect(withWrappers.length).toBeGreaterThanOrEqual(2)
      const [a, b] = withWrappers
      state.token0 = { address: a!.address, program: a!.wrapper_program!, decimals: a!.decimals }
      state.token1 = { address: b!.address, program: b!.wrapper_program!, decimals: b!.decimals }
    }

    // The prover cannot statically discover IARC20 callees — fetch sources.
    const src0 = await getProgram(walletClient, { programId: state.token0.program })
    const src1 = await getProgram(walletClient, { programId: state.token1.program })
    state.imports = { [state.token0.program]: src0, [state.token1.program]: src1 }
  }, 60_000)

  it('privatizes token balances into records (transfer_public_to_private)', async () => {
    // Ensure each token has ONE unspent record large enough for the swap's
    // input draw (record selection picks a single sufficient record — it does
    // not aggregate). Skipping merely on record existence is wrong: prior runs
    // leave small change records that don't cover the swap.
    const hasCovering = async (program: string, need: bigint) => {
      const records = await scanner.requestRecords({ program, statusFilter: 'unspent' })
      return records.some((r) => {
        const info = r.recordPlaintext ? parseTokenRecordInfo(r.recordPlaintext) : null
        return info != null && info.amount >= need
      })
    }

    for (const t of [state.token0!, state.token1!]) {
      const unit = 10n ** BigInt(t.decimals)
      const need = unit / 2n // comfortably covers the swap's 0.1-token input
      if (await hasCovering(t.program, need)) continue

      // Privatize a full unit — comfortable headroom over the swap input.
      const result = await walletClient.executeContract({
        program: t.program,
        function: 'transfer_public_to_private',
        inputs: [account.address, `${unit}u128`],
      })
      expect(result.transactionId).toMatch(/^at1/)

      // The transaction is accepted on-chain, but the RSS indexes the new
      // record asynchronously — poll until it is scannable before the swap
      // tries to select it.
      const visible = await pollUntil(() => hasCovering(t.program, need), 30, 5000)
      expect(visible, `privatized ${t.program} record did not become scannable`).toBe(true)
    }
  }, TX_TIMEOUT * 2)

  it('ensures a pool exists for the pair (API discovery, create, or prior run)', async () => {
    // 1) API discovery — authoritative where the API serves this program
    //    find a live pool for the chosen pair. Skip when the
    //    token-pick step already locked in a specific pool with liquidity —
    //    re-discovering would grab the pair's first initialized pool, which is
    //    often an empty one at a different fee tier.
    if (!state.poolKey) {
      const pools = await client.api.getPools({ limit: 50 })
      for (const p of pools.data) {
        const pair = new Set([p.token0, p.token1])
        if (pair.has(state.token0!.address) && pair.has(state.token1!.address)) {
          if (await client.isPoolInitialized({ poolKey: p.key })) {
            state.poolKey = p.key
            break
          }
        }
      }
    }

    // 2) Create it.
    if (!state.poolKey) {
      const fee = 100 // registered on chain (verified in reads phase)
      try {
        const created = await client.createPool({
          token0ProgramId: state.token0!.address,
          token1ProgramId: state.token1!.address,
          fee,
          initialTick: 0,
        })
        state.poolKey = created.poolKey
      } catch {
        // 3) Pool exists but the API does not serve this program —
        //    recover the key from a prior create_pool call's first output.
        const calls = (await walletClient.request({
          method: 'getProgramCalls',
          params: { programId: DEX_PROGRAM },
        })) as Array<{ function?: string; outputs?: Array<{ value?: string } | string> }>
        for (const call of calls ?? []) {
          if (call.function !== 'create_pool') continue
          const first = call.outputs?.[0]
          const value = typeof first === 'string' ? first : first?.value
          if (value?.endsWith('field') && (await client.isPoolInitialized({ poolKey: value }))) {
            state.poolKey = value
            break
          }
        }
      }
    }
    expect(state.poolKey, 'pool key must be resolvable (discovered or created)').toBeTruthy()
    expect(await client.isPoolInitialized({ poolKey: state.poolKey! })).toBe(true)
  }, TX_TIMEOUT)

  it('swaps privately and the chain computes the output', async () => {
    const pool = await client.getPool({ poolKey: state.poolKey! })
    const tokenIn = pool!.token0
    const inMeta = tokenIn === state.token0!.address ? state.token0! : state.token1!
    const amountIn = 10n ** BigInt(inMeta.decimals) / 10n // 0.1 token

    state.handle = await client.swap({
      poolKey: state.poolKey!,
      tokenInId: tokenIn,
      amountIn,
      slippageBps: 500,
      tokenInProgram: inMeta.program,
      imports: state.imports,
    })
    expect(state.handle.swapId).toMatch(/field$/)
    expect(state.handle.blindedAddress).toMatch(/^aleo1/)

    // The request finalized (executeContract waits), but the swap_outputs
    // mapping write propagates to reads asynchronously — poll until it appears.
    let out: Awaited<ReturnType<typeof client.getSwapOutput>> = null
    const ready = await pollUntil(async () => {
      out = await client.getSwapOutput({ swapId: state.handle!.swapId! })
      return out !== null
    }, 24, 5000)
    expect(ready, 'swap output should be readable after the request finalizes').toBe(true)
    expect(out!.amount_out > 0n).toBe(true)
  }, TX_TIMEOUT)

  it('claims the output as private records and the entry is consumed', async () => {
    const res = await client.claimSwapOutput({ handle: state.handle!, imports: state.imports })
    expect(res.transactionId).toMatch(/^at1/)
    expect(res.amountOut > 0n).toBe(true)

    // The claim consumes swap_outputs[swapId] — but the mapping deletion
    // reflects only after the claim's finalize propagates to reads. Poll.
    const consumed = await pollUntil(
      async () => (await client.getSwapOutput({ swapId: state.handle!.swapId! })) === null,
      24,
      5000,
    )
    expect(consumed, 'swap_outputs entry should be consumed after claim').toBe(true)

    // Claiming again is the documented non-retryable absence.
    await expect(client.claimSwapOutput({ handle: state.handle! })).rejects.toThrow(
      SwapOutputNotFinalizedError,
    )
  }, TX_TIMEOUT)
})
