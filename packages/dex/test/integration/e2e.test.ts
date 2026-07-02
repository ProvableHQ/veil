import { describe, it, expect } from 'vitest'
import { loadNetwork } from '@veil/provable'
import { dexActions } from '../../src/decorators/dexActions.js'
import { getProgram } from '@veil/core'
import { SwapOutputNotFinalizedError } from '../../src/actions/swap/claimSwapOutputPrivate.js'

/**
 * The headline e2e: the full private-swap + liquidity lifecycle against the
 * REAL testnet — airdrop → privatize records → ensure pool → mint →
 * increase → swapPrivate → getSwapOutput → claimSwapOutputPrivate.
 *
 * Requirements (skipped when absent):
 *   VEIL_INTEGRATION=1
 *   VEIL_E2E_PRIVATE_KEY   funded testnet account (credits for fees)
 *   ALEO_DPS_API_KEY, ALEO_CONSUMER_ID   delegated proving credentials
 * Optional: ALEO_DPS_URL, ALEO_RSS_URL, and VEIL_DEX_PROGRAM to pick the
 * deployment under test — defaults to shield_swap_v0_0_1.aleo (the live
 * venue the indexer serves); set shield_swap_v0_0_2.aleo to exercise the
 * new deployment. Both share entrypoints, struct layouts, and domains.
 */
const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY
const DPS_API_KEY = process.env.ALEO_DPS_API_KEY
const CONSUMER_ID = process.env.ALEO_CONSUMER_ID
const RUN = process.env.VEIL_INTEGRATION === '1' && !!PRIVATE_KEY && !!DPS_API_KEY && !!CONSUMER_ID

const NETWORK_URL = 'https://api.provable.com/v2'
const DPS_URL = process.env.ALEO_DPS_URL ?? 'https://api.provable.com/prove/testnet'
const RSS_URL = process.env.ALEO_RSS_URL ?? 'https://rss.provable.com'
const DEX_PROGRAM = process.env.VEIL_DEX_PROGRAM ?? 'shield_swap_v0_0_1.aleo'
const TX_TIMEOUT = 420_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.runIf(RUN)('e2e: private swap + liquidity lifecycle on testnet', async () => {
  const aleo = await loadNetwork('testnet')
  const scanner = aleo.createRemoteScanner({ url: RSS_URL, consumerId: CONSUMER_ID! })
  const { walletClient, account } = aleo.createAleoClient({
    privateKey: PRIVATE_KEY!,
    networkUrl: NETWORK_URL,
    provingMode: 'delegated',
    proverUrl: DPS_URL,
    apiKey: DPS_API_KEY,
    consumerId: CONSUMER_ID,
    records: scanner,
  })
  const client = walletClient.extend(dexActions({ indexer: {}, program: DEX_PROGRAM }))

  // Resolved during the run and shared across steps (tests run in order).
  const state: {
    token0?: { address: string; program: string; decimals: number }
    token1?: { address: string; program: string; decimals: number }
    imports?: Record<string, string>
    poolKey?: string
    handle?: Awaited<ReturnType<typeof client.swapPrivate>>
  } = {}

  it('funds the account via the async airdrop when balances are empty', async () => {
    const balances = await client.indexer.getBalances({ user: account.address })
    const empty = balances.data.length === 0 || balances.data.every((b) => BigInt(b.balance ?? 0) === 0n)
    if (empty) {
      const started = await client.indexer.airdrop(account.address)
      expect(started.job_id).toBeTruthy()
      // Poll until the faucet's per-token transfers settle.
      for (let i = 0; i < 60; i++) {
        const job = await client.indexer.getAirdropStatus(started.job_id)
        if (job.status === 'completed' || job.status === 'done') break
        await sleep(5000)
      }
    }
    const after = await client.indexer.getBalances({ user: account.address })
    expect(after.data.length).toBeGreaterThan(0)
  }, TX_TIMEOUT)

  it('picks a token pair and fetches wrapper program sources (dyn-dispatch imports)', async () => {
    // Prefer a pair with a live pool (v0_0_1 today) so the swap has depth;
    // fall back to the first two wrapper tokens on a fresh deployment.
    const pools = await client.indexer.getPools({ limit: 1 })
    const live = pools.data[0]
    if (live?.token0_info?.wrapper_program && live?.token1_info?.wrapper_program) {
      state.token0 = { address: live.token0, program: live.token0_info.wrapper_program, decimals: live.token0_info.decimals }
      state.token1 = { address: live.token1, program: live.token1_info.wrapper_program, decimals: live.token1_info.decimals }
    } else {
      const tokens = await client.indexer.getTokens()
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
    // One whole token each — multiples of dustScale by construction.
    for (const t of [state.token0!, state.token1!]) {
      const existing = await scanner.requestRecords({ program: t.program, statusFilter: 'unspent' })
      if (existing.length > 0) continue // already privatized in a prior run
      const amount = 10n ** BigInt(t.decimals)
      const result = await walletClient.executeContract({
        program: t.program,
        function: 'transfer_public_to_private',
        inputs: [account.address, `${amount}u128`],
      })
      expect(result.transactionId).toMatch(/^at1/)
    }
  }, TX_TIMEOUT * 2)

  it('ensures a pool exists for the pair (indexer discovery, create, or prior run)', async () => {
    // 1) Indexer discovery — authoritative where the indexer serves this
    //    program (v0_0_1 today): find a live pool for the chosen pair.
    const pools = await client.indexer.getPools({ limit: 50 })
    for (const p of pools.data) {
      const pair = new Set([p.token0, p.token1])
      if (pair.has(state.token0!.address) && pair.has(state.token1!.address)) {
        if (await client.isPoolInitialized({ poolKey: p.key })) {
          state.poolKey = p.key
          break
        }
      }
    }

    // 2) Create it (fresh deployment, e.g. v0_0_2).
    if (!state.poolKey) {
      const fee = 100 // registered on both deployments (verified in reads phase)
      try {
        const created = await client.createPool({
          token0ProgramId: state.token0!.address,
          token1ProgramId: state.token1!.address,
          fee,
          initialTick: 0,
        })
        state.poolKey = created.poolKey
      } catch {
        // 3) Pool exists but the indexer doesn't serve this program —
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

  it('mints a private position', async () => {
    const slot = await client.getSlot({ poolKey: state.poolKey! })
    expect(slot).not.toBeNull()
    const spacing = slot!.tick_spacing
    const minted = await client.mintPrivate({
      poolKey: state.poolKey!,
      tickLower: slot!.tick - spacing * 10,
      tickUpper: slot!.tick + spacing * 10,
      amount0Desired: 10n ** BigInt(state.token0!.decimals) / 2n,
      amount1Desired: 10n ** BigInt(state.token1!.decimals) / 2n,
      token0Program: state.token0!.program,
      token1Program: state.token1!.program,
      imports: state.imports,
    })
    expect(minted.positionTokenId).toMatch(/field$/)
  }, TX_TIMEOUT)

  it('swaps privately and the chain computes the output', async () => {
    const pool = await client.getPool({ poolKey: state.poolKey! })
    const tokenIn = pool!.token0
    const inMeta = tokenIn === state.token0!.address ? state.token0! : state.token1!
    const amountIn = 10n ** BigInt(inMeta.decimals) / 10n // 0.1 token

    state.handle = await client.swapPrivate({
      poolKey: state.poolKey!,
      tokenInId: tokenIn,
      amountIn,
      slippageBps: 500,
      tokenInProgram: inMeta.program,
      imports: state.imports,
    })
    expect(state.handle.swapId).toMatch(/field$/)
    expect(state.handle.blindedAddress).toMatch(/^aleo1/)

    // The request finalized (executeContract waits) — the output must be readable.
    const out = await client.getSwapOutput({ swapId: state.handle.swapId! })
    expect(out).not.toBeNull()
    expect(out!.amount_out > 0n).toBe(true)
  }, TX_TIMEOUT)

  it('claims the output as private records and the entry is consumed', async () => {
    const res = await client.claimSwapOutputPrivate({ handle: state.handle!, imports: state.imports })
    expect(res.transactionId).toMatch(/^at1/)
    expect(res.amountOut > 0n).toBe(true)

    // The claim consumes swap_outputs[swapId].
    expect(await client.getSwapOutput({ swapId: state.handle!.swapId! })).toBeNull()

    // Claiming again is the documented non-retryable absence.
    await expect(client.claimSwapOutputPrivate({ handle: state.handle! })).rejects.toThrow(
      SwapOutputNotFinalizedError,
    )
  }, TX_TIMEOUT)
})
