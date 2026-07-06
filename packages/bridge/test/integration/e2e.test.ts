import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork } from '@veil/provable-sdk'
import { createBridgeClient, type BridgeClient } from '../../src/clients/createBridgeClient.js'
import { httpBridge } from '../../src/transports/httpBridge.js'
import { getOrderAudit } from '../../src/actions/getOrderAudit.js'
import type { SwapReturnType } from '../../src/actions/swap.js'

/**
 * The full bridge swap chain against MAINNET and the live providers,
 * with the route selected from getRoutes() by symbol + chain name at runtime:
 * quote → order → sign + broadcast the Aleo unshield deposit → poll the
 * order to COMPLETED → audit it. This SPENDS REAL ALEO and delivers real
 * SOL to the destination wallet — it is gated separately from the read-only
 * integration tier and must be run deliberately.
 *
 * Requirements (skipped when absent):
 *   VEIL_INTEGRATION=1
 *   VEIL_BRIDGE_E2E=1        explicit opt-in for the fund-moving tier
 *   VEIL_E2E_PRIVATE_KEY     Aleo account funded on MAINNET (deposit + fees)
 *   ALEO_DPS_API_KEY, ALEO_CONSUMER_ID   delegated proving + record scanning
 * Optional:
 *   VEIL_BRIDGE_SWAP_AMOUNT  decimal ALEO to swap (default '5' — providers
 *                            reject amounts below their minimums)
 *   VEIL_BRIDGE_API_URL, ALEO_DPS_URL, ALEO_RSS_URL, VEIL_BRIDGE_DEST_ADDRESS
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
const DPS_URL = process.env.ALEO_DPS_URL ?? 'https://api.provable.com/prove/mainnet'
const RSS_URL = process.env.ALEO_RSS_URL ?? 'https://api.provable.com/scanner'

// The route: native ALEO → SOL to the e2e Solana wallet, via whichever
// provider quotes best (NEAR Intents at the time of writing).
const SWAP_AMOUNT = process.env.VEIL_BRIDGE_SWAP_AMOUNT ?? '5'
const SOL_ADDR = process.env.VEIL_BRIDGE_DEST_ADDRESS ?? '9TtLbwEUUQ677hQ6RdnCCkt1MbBaMjG4Ht4isx56nNnt'

// The deposit spends a private record; keep headroom over the swap amount so
// one record covers deposit + private fee. Microcredits (6 decimals).
const FEE_BUFFER_MICRO = 2_000_000n // 2 ALEO
const TEST_TIMEOUT = 45 * 60_000 // quote+prove+broadcast+bridge; NEAR quotes ~15min ETAs

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Polls an async predicate up to `tries` times, `ms` apart; true once it holds. */
async function pollUntil(predicate: () => Promise<boolean>, tries: number, ms: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return true
    await sleep(ms)
  }
  return false
}

/** Extracts the microcredits amount from a credits.aleo record plaintext. */
function recordMicrocredits(plaintext: string): bigint {
  const match = /microcredits:\s*(\d+)u64/.exec(plaintext)
  return match ? BigInt(match[1]!) : 0n
}

describe.runIf(RUN)('e2e: full bridge swap chain (ALEO → SOL) on mainnet', () => {
  let bridge: BridgeClient
  // The route under test, selected from getRoutes() by symbol + chain name
  // in beforeAll — never hardcoded.
  let aleoAsset: { code: string; chain: string }
  let solAsset: { code: string; chain: string }
  let scanner: Awaited<ReturnType<Awaited<ReturnType<typeof loadNetwork>>['createRemoteScanner']>>
  let walletClient: ReturnType<Awaited<ReturnType<typeof loadNetwork>>['createAleoClient']>['walletClient']
  let account: ReturnType<Awaited<ReturnType<typeof loadNetwork>>['createAleoClient']>['account']
  let result: SwapReturnType

  const depositMicro = () => {
    // SWAP_AMOUNT is a decimal ALEO string; scale to microcredits.
    const [whole, frac = ''] = SWAP_AMOUNT.split('.')
    return BigInt(whole! + frac.padEnd(6, '0').slice(0, 6))
  }

  beforeAll(async () => {
    const aleo = await loadNetwork('mainnet')
    scanner = aleo.createRemoteScanner({ url: RSS_URL, consumerId: CONSUMER_ID!, apiKey: DPS_API_KEY })
    const created = aleo.createAleoClient({
      privateKey: PRIVATE_KEY!,
      networkUrl: NETWORK_URL,
      provingMode: 'delegated',
      proverUrl: DPS_URL,
      apiKey: DPS_API_KEY,
      consumerId: CONSUMER_ID,
      records: scanner,
    })
    walletClient = created.walletClient
    account = created.account
    bridge = createBridgeClient({
      transport: httpBridge(BRIDGE_URL),
      wallet: walletClient,
    })

    // Select the route from the derived route graph, by symbol and chain
    // name — the discovery path a consumer should use.
    const routes = await bridge.getRoutes({ symbol: 'SOL' })
    const route = routes.find(
      (r) => r.aleoAsset.native && r.externalAsset.native && r.externalAsset.chainName === 'Solana',
    )
    if (!route) throw new Error('no candidate route native ALEO <-> native SOL on Solana')
    aleoAsset = route.aleoAsset
    solAsset = route.externalAsset
  }, 120_000)

  it('quotes the route with a live provider before committing funds', async () => {
    const { quotes, meta } = await bridge.getQuotes({
      srcChain: aleoAsset.chain,
      srcAsset: aleoAsset.code,
      destChain: solAsset.chain,
      destAsset: solAsset.code,
      amountIn: SWAP_AMOUNT,
      recipientAddress: SOL_ADDR,
      refundAddress: account.address,
    })

    // Fail here — before any funds move — if no provider will take the route
    // at this amount; providerErrors names minimums when that is the cause.
    expect(
      quotes.length,
      `no provider quoted ALEO→SOL for ${SWAP_AMOUNT} ALEO (quoteRequestId ${meta.quoteRequestId}; providerErrors ${JSON.stringify(meta.providerErrors ?? null)})`,
    ).toBeGreaterThan(0)
    for (const q of quotes) {
      expect(Number(q.amountOut)).toBeGreaterThan(0)
      expect(q.quoteId ?? q.quoteOptionId).toBeTruthy()
    }
  }, 90_000)

  it('ensures a private ALEO record covers deposit + fee', async () => {
    const need = depositMicro() + FEE_BUFFER_MICRO
    const hasCovering = async () => {
      const records = await scanner.requestRecords({ program: 'credits.aleo', statusFilter: 'unspent' })
      return records.some((r) => r.recordPlaintext != null && recordMicrocredits(r.recordPlaintext) >= need)
    }

    if (await hasCovering()) return

    // Shield public balance into a private record for the unshield deposit.
    const txId = await walletClient.transfer({
      to: account.address,
      amount: need,
      visibility: 'shield',
    })
    expect(txId).toMatch(/^at1/)

    // The transaction confirms on-chain, but the scanner indexes the new
    // record asynchronously — wait until it is spendable.
    const visible = await pollUntil(hasCovering, 60, 5000)
    expect(visible, 'shielded record did not become scannable').toBe(true)
  }, TEST_TIMEOUT)

  it('runs the whole swap chain: quote → order → deposit → COMPLETED', async () => {
    const stages: string[] = []
    result = await bridge.swap({
      from: { asset: aleoAsset.code, amount: SWAP_AMOUNT },
      to: { chain: solAsset.chain, asset: solAsset.code, address: SOL_ADDR },
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
    expect(result.orderId).toBeTruthy()
    expect(result.quoteRequestId).toBeTruthy()
    expect(result.finalStatus?.status).toBe('COMPLETED')
    // The order progressed through at least one intermediate stage.
    expect(stages.length).toBeGreaterThan(0)
  }, TEST_TIMEOUT)

  it('the completed order is trackable and auditable', async () => {
    const status = await bridge.getOrder({ id: result.orderId })
    expect(status.status).toBe('COMPLETED')

    const audit = await getOrderAudit(bridge, { id: result.orderId })
    expect(audit.orderId).toBe(result.orderId)
    // The audit carries the full workflow: the happy path ends at COMPLETED.
    expect(audit.steps.some((s) => s.key === 'COMPLETED' && s.status === 'COMPLETED')).toBe(true)
    expect(audit.providerEvents.length).toBeGreaterThan(0)
  }, 90_000)
})
