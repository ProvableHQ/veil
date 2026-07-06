import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork } from '@veil/provable-sdk'
import { getProgram } from '@veil/core'
import { createBridgeClient, httpBridge, type BridgeClient } from '@veil/bridge'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { parseTokenRecordInfo } from '../../src/utils/records.js'

/**
 * The cross-product round trip: bridge in → swap on Shield Swap → bridge out,
 * exercising both packages' encapsulated swap methods on one account.
 *
 * One leg cannot be automated: an INBOUND bridge deposit is signed on the
 * source chain (Ethereum, Solana, …), and this SDK holds only Aleo keys. The
 * bridge-in step therefore verifies the inbound route end-to-end up to the
 * deposit (live quote with actionable id) and documents the manual deposit;
 * the DEX swap and the outbound bridge leg move real funds.
 *
 * A second seam to know about: the bridge operates on MAINNET while
 * shield_swap is deployed on TESTNET at the time of writing, so the two
 * funded legs run on different networks with the same key. When the DEX
 * lands on mainnet, point VEIL_DEX_NETWORK/VEIL_DEX_PROGRAM at it and the
 * whole chain runs on one network.
 *
 * Requirements (skipped when absent):
 *   VEIL_INTEGRATION=1
 *   VEIL_BRIDGE_E2E=1        explicit opt-in — the bridge leg spends mainnet ALEO
 *   VEIL_E2E_PRIVATE_KEY     funded on testnet (DEX leg) and mainnet (bridge leg)
 *   ALEO_DPS_API_KEY, ALEO_CONSUMER_ID   delegated proving + record scanning
 * Optional: VEIL_DEX_NETWORK/VEIL_DEX_PROGRAM, VEIL_BRIDGE_API_URL,
 *   VEIL_BRIDGE_SWAP_AMOUNT, VEIL_BRIDGE_DEST_ADDRESS, ALEO_DPS_URL, ALEO_RSS_URL
 */
const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY
const DPS_API_KEY = process.env.ALEO_DPS_API_KEY
const CONSUMER_ID = process.env.ALEO_CONSUMER_ID
const RUN =
  process.env.VEIL_INTEGRATION === '1' &&
  process.env.VEIL_BRIDGE_E2E === '1' &&
  !!PRIVATE_KEY &&
  !!DPS_API_KEY &&
  !!CONSUMER_ID

const BRIDGE_URL = process.env.VEIL_BRIDGE_API_URL ?? 'https://wallet.api.provable.com'
const NETWORK_URL = 'https://api.provable.com/v2'
const RSS_URL = process.env.ALEO_RSS_URL ?? 'https://api.provable.com/scanner'

// The DEX leg's network and deployment (testnet today).
const DEX_NETWORK = (process.env.VEIL_DEX_NETWORK ?? 'testnet') as 'mainnet' | 'testnet'
const DEX_PROGRAM = process.env.VEIL_DEX_PROGRAM ?? 'shield_swap_v0_0_2.aleo'

// The bridge legs' route endpoints — the e2e wallets.
const ETH_ADDR = '0x734C0a5AB55885974cEDb9D6ff71d8E8448c7375'
const SOL_ADDR = process.env.VEIL_BRIDGE_DEST_ADDRESS ?? '9TtLbwEUUQ677hQ6RdnCCkt1MbBaMjG4Ht4isx56nNnt'
const BRIDGE_OUT_AMOUNT = process.env.VEIL_BRIDGE_SWAP_AMOUNT ?? '5' // decimal ALEO

const TX_TIMEOUT = 420_000
const BRIDGE_TIMEOUT = 45 * 60_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Polls an async predicate up to `tries` times, `ms` apart; true once it holds. */
async function pollUntil(predicate: () => Promise<boolean>, tries: number, ms: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return true
    await sleep(ms)
  }
  return false
}

describe.runIf(RUN)('e2e: bridge in → Shield Swap → bridge out', () => {
  // DEX-side client (testnet today), decorated with the shield_swap actions.
  let dex: ReturnType<ReturnType<typeof shieldSwapActions>>
  let dexWallet: Awaited<ReturnType<typeof buildDexClient>>['walletClient']
  let dexScanner: Awaited<ReturnType<typeof buildDexClient>>['scanner']
  // Bridge-side client (mainnet), carrying its own wallet for the deposit leg.
  let bridge: BridgeClient
  let address: string
  // Route identifiers resolved from the live catalog in beforeAll — never hardcoded.
  let usdcEth: { code: string; chain: string }
  let usdcAleo: { code: string; chain: string }
  let nativeAleo: { code: string; chain: string }
  let nativeSol: { code: string; chain: string }

  async function buildDexClient() {
    const aleo = await loadNetwork(DEX_NETWORK)
    const scanner = aleo.createRemoteScanner({ url: RSS_URL, consumerId: CONSUMER_ID!, apiKey: DPS_API_KEY })
    const { walletClient, account } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY!,
      networkUrl: NETWORK_URL,
      provingMode: 'delegated',
      proverUrl: process.env.ALEO_DPS_URL ?? `https://api.provable.com/prove/${DEX_NETWORK}`,
      apiKey: DPS_API_KEY,
      consumerId: CONSUMER_ID,
      records: scanner,
    })
    return { walletClient, account, scanner }
  }

  beforeAll(async () => {
    const dexSide = await buildDexClient()
    dexWallet = dexSide.walletClient
    dexScanner = dexSide.scanner
    address = dexSide.account.address
    dex = dexSide.walletClient.extend(shieldSwapActions({ api: {}, program: DEX_PROGRAM }))

    const mainnet = await loadNetwork('mainnet')
    const bridgeScanner = mainnet.createRemoteScanner({ url: RSS_URL, consumerId: CONSUMER_ID!, apiKey: DPS_API_KEY })
    const { walletClient: bridgeWallet } = mainnet.createAleoClient({
      privateKey: PRIVATE_KEY!,
      networkUrl: NETWORK_URL,
      provingMode: 'delegated',
      proverUrl: process.env.ALEO_DPS_URL ?? 'https://api.provable.com/prove/mainnet',
      apiKey: DPS_API_KEY,
      consumerId: CONSUMER_ID,
      records: bridgeScanner,
    })
    bridge = createBridgeClient({ transport: httpBridge(BRIDGE_URL), wallet: bridgeWallet })

    // Discover every identifier the bridge legs use from the asset catalog.
    const assets = await bridge.getAssets()
    const pick = (what: string, pred: (a: (typeof assets)[number]) => boolean) => {
      const found = assets.find(pred)
      if (!found) throw new Error(`asset catalog no longer lists ${what}`)
      return found
    }
    usdcEth = pick('USDC on EVM:1', (a) => a.symbol === 'USDC' && a.chain === 'EVM:1')
    usdcAleo = pick('USDC on ALEO', (a) => a.symbol === 'USDC' && a.chain === 'ALEO')
    nativeAleo = pick('native ALEO', (a) => a.chain === 'ALEO' && a.native)
    nativeSol = pick('native SOL', (a) => a.chain === 'SOLANA' && a.native)
  }, 180_000)

  it('bridge in: the inbound route quotes end-to-end up to the deposit', async () => {
    // Everything the SDK can do for an inbound swap: a live quote with an
    // actionable id, addressed to this account. The deposit itself is signed
    // on the source chain (a real inbound run would createOrder from this
    // quote and pay order.depositAddress from the Ethereum wallet).
    const { quotes, meta } = await bridge.getQuotes({
      srcChain: usdcEth.chain,
      srcAsset: usdcEth.code,
      destChain: usdcAleo.chain,
      destAsset: usdcAleo.code,
      amountIn: '100',
      recipientAddress: address,
      refundAddress: ETH_ADDR,
    })

    expect(meta.quoteRequestId).toBeTruthy()
    expect(
      quotes.length,
      `no provider quoted the inbound USDC route (providerErrors ${JSON.stringify(meta.providerErrors ?? null)})`,
    ).toBeGreaterThan(0)
    for (const q of quotes) {
      expect(q.destAsset).toBe(usdcAleo.code)
      expect(Number(q.amountOut)).toBeGreaterThan(0)
      expect(q.quoteId ?? q.quoteOptionId).toBeTruthy()
    }
  }, 90_000)

  it('swaps on Shield Swap: pick a live pool, privatize, swapPrivate, claim', async () => {
    // Discover a pool the account can trade: wrappers on both tokens,
    // non-zero public balance for the input, and live liquidity.
    const pools = await dex.api.getPools({ limit: 50 })
    const balances = await dex.api.getPublicBalances({ user: address })
    const funded = new Set(balances.data.filter((b) => BigInt(b.balance ?? 0) > 0n).map((b) => b.token_id))

    let pool: (typeof pools.data)[number] | undefined
    for (const p of pools.data) {
      if (!p.token0_info?.wrapper_program || !p.token1_info?.wrapper_program) continue
      if (!funded.has(p.token0) && !funded.has(p.token1)) continue
      const slot = await dex.getSlot({ poolKey: p.key })
      if (slot && slot.liquidity > 0n) {
        pool = p
        break
      }
    }
    expect(pool, 'need a live pool the account can fund').toBeTruthy()

    // Swap in whichever side the account holds.
    const zeroForOne = funded.has(pool!.token0)
    const tokenIn = zeroForOne ? pool!.token0 : pool!.token1
    const inInfo = zeroForOne ? pool!.token0_info! : pool!.token1_info!
    const outInfo = zeroForOne ? pool!.token1_info! : pool!.token0_info!
    const amountIn = 10n ** BigInt(inInfo.decimals) / 10n // 0.1 token

    // The prover cannot statically discover IARC20 callees — fetch sources.
    const src0 = await getProgram(dexWallet, { programId: inInfo.wrapper_program! })
    const src1 = await getProgram(dexWallet, { programId: outInfo.wrapper_program! })
    const imports = { [inInfo.wrapper_program!]: src0, [outInfo.wrapper_program!]: src1 }

    // Ensure ONE unspent record covers the swap input (selection picks a
    // single sufficient record — it does not aggregate).
    const hasCovering = async () => {
      const records = await dexScanner.requestRecords({ program: inInfo.wrapper_program!, statusFilter: 'unspent' })
      return records.some((r) => {
        const info = r.recordPlaintext ? parseTokenRecordInfo(r.recordPlaintext) : null
        return info != null && info.amount >= amountIn
      })
    }
    if (!(await hasCovering())) {
      const unit = 10n ** BigInt(inInfo.decimals)
      const res = await dexWallet.executeContract({
        program: inInfo.wrapper_program!,
        function: 'transfer_public_to_private',
        inputs: [address, `${unit}u128`],
      })
      expect(res.transactionId).toMatch(/^at1/)
      expect(await pollUntil(hasCovering, 30, 5000), 'privatized record did not become scannable').toBe(true)
    }

    // The encapsulated private swap: request, chain computes, claim.
    const handle = await dex.swapPrivate({
      poolKey: pool!.key,
      tokenInId: tokenIn,
      amountIn,
      slippageBps: 500,
      tokenInProgram: inInfo.wrapper_program!,
      imports,
    })
    expect(handle.swapId).toMatch(/field$/)

    const claim = await dex.claimSwapOutputPrivate({ handle, imports })
    expect(claim.transactionId).toMatch(/^at1/)
    expect(claim.amountOut > 0n).toBe(true)
  }, TX_TIMEOUT * 3)

  it('bridge out: the proceeds leave via the encapsulated bridge swap', async () => {
    // Bridge native ALEO out to the e2e Solana wallet, polling to COMPLETED.
    // (Native ALEO rather than the DEX output: outbound routes currently
    // exist only for ALEO_MAINNET, and the bridge leg runs on mainnet.)
    const stages: string[] = []
    const result = await bridge.swap({
      from: { asset: nativeAleo.code, amount: BRIDGE_OUT_AMOUNT },
      to: { chain: nativeSol.chain, asset: nativeSol.code, address: SOL_ADDR },
      selectQuote: 'best',
      poll: true,
      onStage: (s) => {
        if (stages[stages.length - 1] !== s.status) {
          stages.push(s.status)
          console.log(`bridge order ${s.orderId}: ${s.status}`)
        }
      },
    })

    expect(result.depositTxId).toMatch(/^at1/)
    expect(result.finalStatus?.status).toBe('COMPLETED')
  }, BRIDGE_TIMEOUT)
})
