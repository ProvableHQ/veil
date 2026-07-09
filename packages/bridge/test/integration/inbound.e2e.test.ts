import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork } from '@provablehq/veil-sdk'
import {
  createWalletClient as createEvmWalletClient,
  http as evmHttp,
  erc20Abi,
  parseUnits,
} from 'viem'
import { privateKeyToAccount as evmPrivateKeyToAccount } from 'viem/accounts'
import { mainnet as ethereumMainnet } from 'viem/chains'
import { createBridgeClient, type BridgeClient } from '../../src/clients/createBridgeClient.js'
import { httpBridge } from '../../src/transports/httpBridge.js'
import type { BridgeOrderInstructions } from '../../src/types/bridge.js'

/**
 * The full INBOUND swap chain on MAINNET: USDC on Ethereum → native ALEO.
 * The Ethereum deposit is signed with viem (the one leg Veil's Aleo keys
 * cannot sign), everything else is the bridge client: route discovery,
 * quote, order, poll to COMPLETED, and an on-chain balance-delta check.
 * This SPENDS REAL USDC and gas on Ethereum and delivers real ALEO — it is
 * gated separately and must be run deliberately.
 *
 * Once the deposit transaction is sent, funds are committed to the provider
 * flow: the recovery path is the provider's refund to ETH_REFUND (the
 * order's refundAddress), not a revert.
 *
 * Requirements (skipped when absent):
 *   VEIL_INTEGRATION=1
 *   VEIL_BRIDGE_E2E=1        explicit opt-in for the fund-moving tier
 *   ETH_PRIVATE_KEY          Ethereum account holding USDC + gas
 *   VEIL_E2E_PRIVATE_KEY     the receiving Aleo account
 *   ALEO_DPS_API_KEY, ALEO_CONSUMER_ID
 * Optional:
 *   VEIL_BRIDGE_INBOUND_AMOUNT  decimal USDC to bridge (default '25' —
 *                               providers reject amounts below their minimums)
 *   ETH_RPC_URL, ETH_USDC_CONTRACT, VEIL_BRIDGE_API_URL
 */
const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY
const ETH_KEY = process.env.ETH_PRIVATE_KEY
const DPS_API_KEY = process.env.ALEO_DPS_API_KEY
const CONSUMER_ID = process.env.ALEO_CONSUMER_ID
const RUN =
  process.env.VEIL_INTEGRATION === '1' &&
  process.env.VEIL_BRIDGE_E2E === '1' &&
  !!PRIVATE_KEY &&
  !!ETH_KEY &&
  !!DPS_API_KEY &&
  !!CONSUMER_ID

const BRIDGE_URL = process.env.VEIL_BRIDGE_API_URL ?? 'https://wallet.api.provable.com'
const NETWORK_URL = 'https://api.provable.com/v2'
const AMOUNT = process.env.VEIL_BRIDGE_INBOUND_AMOUNT ?? '25' // decimal USDC
// Canonical USDC on Ethereum mainnet; override if the route's source moves.
const USDC_CONTRACT = (process.env.ETH_USDC_CONTRACT ??
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48') as `0x${string}`

const TEST_TIMEOUT = 45 * 60_000 // ETH confirmation + provider swap; NEAR/Halliday quote ~15min ETAs

describe.runIf(RUN)('e2e: inbound bridge swap (USDC on Ethereum → native ALEO)', () => {
  let bridge: BridgeClient
  let publicClient: ReturnType<Awaited<ReturnType<typeof loadNetwork>>['createAleoClient']>['publicClient']
  let aleoAddress: string
  let evm: ReturnType<typeof createEvmWalletClient>
  let ethAddress: `0x${string}`
  // Route sides resolved from the graph; the order + deposit under test.
  let usdcEth: { code: string; chain: string; decimals: number }
  let nativeAleo: { code: string; chain: string }
  let quoteId: string
  let providerId: string
  let order: BridgeOrderInstructions
  let balanceBefore: bigint

  beforeAll(async () => {
    // Aleo side: the receiving account (reads only — no Aleo signing needed
    // for the inbound leg itself).
    const aleo = await loadNetwork('mainnet')
    const created = aleo.createAleoClient({
      privateKey: PRIVATE_KEY!,
      networkUrl: NETWORK_URL,
      provingMode: 'delegated',
      proverUrl: process.env.ALEO_DPS_URL ?? 'https://api.provable.com/prove/mainnet',
      apiKey: DPS_API_KEY,
      consumerId: CONSUMER_ID,
    })
    publicClient = created.publicClient
    aleoAddress = created.account.address

    // Ethereum side: viem signs the deposit.
    const account = evmPrivateKeyToAccount(ETH_KEY as `0x${string}`)
    ethAddress = account.address
    evm = createEvmWalletClient({
      account,
      chain: ethereumMainnet,
      transport: evmHttp(process.env.ETH_RPC_URL),
    })

    bridge = createBridgeClient({ transport: httpBridge(BRIDGE_URL) })

    // Route from the graph, by symbol and chain name.
    const routes = await bridge.getRoutes({ symbol: 'USDC', externalChain: 'Ethereum' })
    const route = routes.find((r) => r.aleoAsset.native && r.externalAsset.symbol === 'USDC')
    if (!route) throw new Error('no candidate route USDC on Ethereum <-> native ALEO')
    usdcEth = route.externalAsset
    nativeAleo = route.aleoAsset
  }, 120_000)

  it('quotes the inbound route before committing funds', async () => {
    const { quotes, meta } = await bridge.getQuotes({
      srcChain: usdcEth.chain,
      srcAsset: usdcEth.code,
      destChain: nativeAleo.chain,
      destAsset: nativeAleo.code,
      amountIn: AMOUNT,
      recipientAddress: aleoAddress,
      refundAddress: ethAddress,
    })

    expect(
      quotes.length,
      `no provider quoted USDC→ALEO for ${AMOUNT} USDC (quoteRequestId ${meta.quoteRequestId}; providerErrors ${JSON.stringify(meta.providerErrors ?? null)})`,
    ).toBeGreaterThan(0)
    const q = quotes[0]!
    expect(Number(q.amountOut)).toBeGreaterThan(0)
    quoteId = (q.quoteId ?? q.quoteOptionId)!
    providerId = q.provider.id
    expect(quoteId).toBeTruthy()
  }, 90_000)

  it('creates the order and its deposit instructions are payable by an ERC-20 transfer', async () => {
    order = await bridge.createOrder({
      providerId,
      srcChain: usdcEth.chain,
      destChain: nativeAleo.chain,
      srcAsset: usdcEth.code,
      destAsset: nativeAleo.code,
      amountIn: AMOUNT,
      walletAddress: aleoAddress, // the payout recipient
      quoteId,
      refundAddress: ethAddress,
    })

    expect(order.orderId).toBeTruthy()
    expect(order.depositAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(order.depositAmount).toBeTruthy()
    // A plain ERC-20 transfer cannot carry a memo; refuse before paying.
    expect(order.depositMemo, 'memo-tagged EVM deposit is unpayable here').toBeFalsy()
    if (order.expiration) {
      expect(new Date(order.expiration).getTime()).toBeGreaterThan(Date.now())
    }
  }, 90_000)

  it('pays the deposit from the Ethereum wallet via viem', async () => {
    balanceBefore = await publicClient.getBalance({ address: aleoAddress })

    const txHash = await evm.writeContract({
      address: USDC_CONTRACT,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [order.depositAddress as `0x${string}`, parseUnits(order.depositAmount!, usdcEth.decimals)],
    })
    expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    console.log(`deposit sent: ${txHash} → ${order.depositAddress} (${order.depositAmount} USDC)`)
  }, 300_000)

  it('the order completes and the ALEO arrives as public balance', async () => {
    const stages: string[] = []
    const done = await bridge.waitForOrder({
      id: order.orderId,
      onStage: (s) => {
        if (stages[stages.length - 1] !== s.status) {
          stages.push(s.status)
          console.log(`bridge order ${s.orderId}: ${s.status}`)
        }
      },
    })
    expect(done.status).toBe('COMPLETED')

    // Native ALEO arrival is a plain credits balance delta — the reason this
    // e2e targets native ALEO rather than a wrapped asset.
    const balanceAfter = await publicClient.getBalance({ address: aleoAddress })
    expect(balanceAfter).toBeGreaterThan(balanceBefore)
    console.log(`arrived: ${balanceAfter - balanceBefore} microcredits`)
  }, TEST_TIMEOUT)
})
