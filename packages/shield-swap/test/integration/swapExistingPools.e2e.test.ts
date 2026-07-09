import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork } from '@veil/provable-sdk'
import { getProgram } from '@veil/core'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { parseTokenRecordInfo } from '../../src/utils/records.js'

/**
 * Reads live pools on testnet and swaps against one of them — the minimal
 * swap path with no pool creation. Discovers an existing pool with on-chain
 * liquidity that the account can fund, privatizes the input token, submits a
 * private swap, reads the chain-computed output, and claims it.
 *
 * Requirements (skipped when absent):
 *   VEIL_INTEGRATION=1
 *   VEIL_E2E_PRIVATE_KEY   funded testnet account (credits for fees)
 *   ALEO_DPS_API_KEY, ALEO_CONSUMER_ID   delegated proving credentials
 * Optional: ALEO_DPS_URL, ALEO_RSS_URL, VEIL_DEX_PROGRAM (defaults to
 * shield_swap_v3.aleo).
 *
 * Run with:
 *   VEIL_INTEGRATION=1 npx vitest run packages/shield-swap/test/integration/swapExistingPools.e2e.test.ts
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
async function pollUntil(predicate: () => Promise<boolean>, tries: number, ms: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return true
    await sleep(ms)
  }
  return false
}

describe.runIf(RUN)('e2e: swap against an existing testnet pool', () => {
  let scanner: ReturnType<Awaited<ReturnType<typeof loadNetwork>>['createRemoteScanner']>
  let walletClient: ReturnType<Awaited<ReturnType<typeof loadNetwork>>['createAleoClient']>['walletClient']
  let account: ReturnType<Awaited<ReturnType<typeof loadNetwork>>['createAleoClient']>['account']
  let dex: ReturnType<ReturnType<typeof shieldSwapActions>>

  const state: {
    poolKey?: string
    tokenIn?: { address: string; program: string; decimals: number }
    imports?: Record<string, string>
    handle?: Awaited<ReturnType<ReturnType<ReturnType<typeof shieldSwapActions>>['swap']>>
  } = {}

  beforeAll(async () => {
    const aleo = await loadNetwork('testnet')
    scanner = aleo.createRemoteScanner({ url: RSS_URL, consumerId: CONSUMER_ID!, apiKey: DPS_API_KEY })
    ;({ walletClient, account } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY!,
      networkUrl: NETWORK_URL,
      provingMode: 'delegated',
      proverUrl: DPS_URL,
      apiKey: DPS_API_KEY,
      consumerId: CONSUMER_ID,
      records: scanner,
    }))
    dex = walletClient.extend(shieldSwapActions({ api: {}, program: DEX_PROGRAM }))

    // No pools to swap against → skip funding entirely so the no-pool case
    // resolves in seconds rather than waiting out the faucet poll.
    if ((await dex.api.getPools({ limit: 1 })).data.length === 0) return

    // Airdrop once if the account holds nothing — the swap privatizes public
    // balance, so it needs a funded token. The faucet is auth-gated, so run
    // the DEX API challenge/verify handshake first (signs with the account).
    // Best-effort: poll the account's balance rather than the ephemeral faucet
    // job, and don't abort the suite if the faucet misbehaves — the discovery
    // step reports an unfunded account with a clear message.
    const funded = async () => {
      const b = await dex.api.getPublicBalances({ user: account.address })
      return b.data.some((x) => BigInt(x.balance ?? 0) > 0n)
    }
    if (!(await funded())) {
      try {
        await dex.api.authenticate(account.address, async (message) => {
          const sig = await account.sign(new TextEncoder().encode(message))
          return new TextDecoder().decode(sig)
        })
        await dex.api.airdrop(account.address)
      } catch (err) {
        console.warn('airdrop request failed (continuing to poll balances):', (err as Error).message)
      }
      await pollUntil(funded, 60, 5000)
    }
  }, TX_TIMEOUT)

  it('discovers an existing pool with liquidity the account can fund', async (ctx) => {
    const pools = await dex.api.getPools({ limit: 50 })
    const balances = await dex.api.getPublicBalances({ user: account.address })
    const funded = new Set(balances.data.filter((b) => BigInt(b.balance ?? 0) > 0n).map((b) => b.token_id))

    // A live pool needs: both tokens wrapper-backed, non-zero on-chain
    // liquidity, and the account funded in one of the two tokens (that side
    // becomes the swap input — either direction works).
    for (const p of pools.data) {
      if (!p.token0_info?.wrapper_program || !p.token1_info?.wrapper_program) continue
      const inInfo = funded.has(p.token0) ? p.token0_info : funded.has(p.token1) ? p.token1_info : undefined
      if (!inInfo) continue
      const slot = await dex.getSlot({ poolKey: p.key })
      if (!slot || slot.liquidity === 0n) continue
      const inAddress = inInfo === p.token0_info ? p.token0 : p.token1
      state.poolKey = p.key
      state.tokenIn = { address: inAddress, program: inInfo.wrapper_program!, decimals: inInfo.decimals }
      const src = await getProgram(walletClient, { programId: state.tokenIn.program })
      state.imports = { [state.tokenIn.program]: src }
      break
    }

    // The testnet v3 deployment has no indexed pools yet; skip until it does
    // (the devnode lifecycle suites cover the create+swap path hermetically).
    if (!state.poolKey) {
      console.warn(
        `No live ${DEX_PROGRAM} pool with liquidity the account can fund ` +
          `(${pools.data.length} pools served) — skipping the swap lifecycle.`,
      )
      ctx.skip()
    }
    expect(await dex.isPoolInitialized({ poolKey: state.poolKey! })).toBe(true)
  }, TX_TIMEOUT)

  it('privatizes an input record covering the swap', async (ctx) => {
    if (!state.poolKey) ctx.skip()
    const unit = 10n ** BigInt(state.tokenIn!.decimals)
    const need = unit / 2n
    const hasCovering = async () => {
      const records = await scanner.requestRecords({ program: state.tokenIn!.program, statusFilter: 'unspent' })
      return records.some((r) => {
        const info = r.recordPlaintext ? parseTokenRecordInfo(r.recordPlaintext) : null
        return info != null && info.amount >= need
      })
    }
    if (!(await hasCovering())) {
      const result = await walletClient.executeContract({
        program: state.tokenIn!.program,
        function: 'transfer_public_to_private',
        inputs: [account.address, `${unit}u128`],
      })
      expect(result.transactionId).toMatch(/^at1/)
      // RSS indexes the new record asynchronously — wait until scannable.
      const visible = await pollUntil(hasCovering, 30, 5000)
      expect(visible, 'privatized record did not become scannable').toBe(true)
    }
  }, TX_TIMEOUT * 2)

  it('swaps against the pool and the chain computes an output', async (ctx) => {
    if (!state.poolKey) ctx.skip()
    const amountIn = 10n ** BigInt(state.tokenIn!.decimals) / 10n // 0.1 token
    state.handle = await dex.swap({
      poolKey: state.poolKey!,
      tokenInId: state.tokenIn!.address,
      amountIn,
      slippageBps: 500,
      tokenInProgram: state.tokenIn!.program,
      imports: state.imports,
    })
    expect(state.handle.swapId).toMatch(/field$/)

    // The swap_outputs write propagates to reads asynchronously — poll.
    let out: Awaited<ReturnType<typeof dex.getSwapOutput>> = null
    const ready = await pollUntil(async () => {
      out = await dex.getSwapOutput({ swapId: state.handle!.swapId! })
      return out !== null
    }, 24, 5000)
    expect(ready, 'swap output should be readable after the request finalizes').toBe(true)
    expect(out!.amount_out > 0n).toBe(true)
  }, TX_TIMEOUT)

  it('claims the output as private records', async (ctx) => {
    if (!state.handle) ctx.skip()
    const res = await dex.claimSwapOutput({ handle: state.handle!, imports: state.imports })
    expect(res.transactionId).toMatch(/^at1/)
    expect(res.amountOut > 0n).toBe(true)

    // The claim consumes swap_outputs[swapId].
    const consumed = await pollUntil(
      async () => (await dex.getSwapOutput({ swapId: state.handle!.swapId! })) === null,
      24,
      5000,
    )
    expect(consumed, 'swap_outputs entry should be consumed after claim').toBe(true)
  }, TX_TIMEOUT)
})
