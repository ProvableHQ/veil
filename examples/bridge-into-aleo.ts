/**
 * Bridging INTO Aleo: USDC on Ethereum → native ALEO
 *
 * The inbound deposit is signed on the source chain, so this example uses
 * two signers: viem for the Ethereum leg, Veil for everything else. If you
 * know viem, you already know both halves.
 *
 * The flow:
 *   1. Discover the route from the catalog (no hardcoded identifiers)
 *   2. Quote it — fail here, before any funds move, if no provider will take it
 *   3. Create the bridge order (a real server-side order; unfunded orders expire)
 *   4. Pay the deposit instructions from the Ethereum wallet — plain viem
 *   5. Poll the order to COMPLETED; the ALEO arrives as public balance
 *   6. Optionally shield it — the privacy-native final step
 *
 * This MOVES REAL FUNDS (USDC + gas on Ethereum), so it is gated like the
 * fund-moving e2e tier. Run with:
 *
 *   VEIL_INTEGRATION=1 VEIL_BRIDGE_E2E=1 \
 *   ETH_PRIVATE_KEY=0x... VEIL_E2E_PRIVATE_KEY=APrivateKey1... \
 *   ALEO_DPS_API_KEY=... ALEO_CONSUMER_ID=... \
 *   npx vitest run examples/bridge-into-aleo.ts
 *
 * Once the ERC-20 transfer is sent, funds are committed to the provider
 * flow — the recovery path is the provider's refund to your Ethereum
 * address, not a revert.
 */

import { describe, it, expect } from 'vitest'
import { createWalletClient, http, erc20Abi, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { createBridgeClient, httpBridge } from '../packages/bridge/src/index.js'
import { loadNetwork } from '../packages/provable-sdk/src/index.js'

const RUN =
  process.env.VEIL_INTEGRATION === '1' &&
  process.env.VEIL_BRIDGE_E2E === '1' &&
  !!process.env.ETH_PRIVATE_KEY &&
  !!process.env.VEIL_E2E_PRIVATE_KEY &&
  !!process.env.ALEO_DPS_API_KEY &&
  !!process.env.ALEO_CONSUMER_ID

const AMOUNT = process.env.VEIL_BRIDGE_INBOUND_AMOUNT ?? '25' // decimal USDC
const USDC_ON_ETHEREUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const

describe.runIf(RUN)('example: bridge USDC on Ethereum into Aleo', () => {
  it('runs the whole inbound flow', async () => {
    // ---- Setup: one Aleo account (receiving), one Ethereum account (paying).
    const aleo = await loadNetwork('mainnet')
    const { publicClient, account: aleoAccount } = aleo.createAleoClient({
      privateKey: process.env.VEIL_E2E_PRIVATE_KEY!,
      networkUrl: 'https://api.provable.com/v2',
      provingMode: 'delegated',
      proverUrl: 'https://api.provable.com/prove/mainnet',
      apiKey: process.env.ALEO_DPS_API_KEY,
      consumerId: process.env.ALEO_CONSUMER_ID,
    })

    const ethAccount = privateKeyToAccount(process.env.ETH_PRIVATE_KEY as `0x${string}`)
    const evm = createWalletClient({
      account: ethAccount,
      chain: mainnet,
      transport: http(process.env.ETH_RPC_URL),
    })

    const bridge = createBridgeClient({
      transport: httpBridge('https://wallet.api.provable.com'),
    })

    // ---- 1. Discover the route. No identifiers hardcoded: filter the graph
    // by symbol and chain name, take the pair whose Aleo side is native.
    const routes = await bridge.getRoutes({ symbol: 'USDC', externalChain: 'Ethereum' })
    const route = routes.find((r) => r.aleoAsset.native && r.externalAsset.symbol === 'USDC')!
    console.log(`route: ${route.externalAsset.code} (${route.externalAsset.chainName}) → ${route.aleoAsset.code} via ${route.providers.join(', ')}`)

    // ---- 2. Quote it. recipientAddress is the Aleo account; refundAddress
    // is the Ethereum account (refunds happen on the source chain).
    const { quotes, meta } = await bridge.getQuotes({
      srcChain: route.externalAsset.chain,
      srcAsset: route.externalAsset.code,
      destChain: route.aleoAsset.chain,
      destAsset: route.aleoAsset.code,
      amountIn: AMOUNT,
      recipientAddress: aleoAccount.address,
      refundAddress: ethAccount.address,
    })
    expect(quotes.length, `no quotes (support handle ${meta.quoteRequestId})`).toBeGreaterThan(0)
    const quote = quotes[0]!
    console.log(`quote: ${AMOUNT} USDC → ~${quote.amountOut} ALEO via ${quote.provider.code} (~${quote.estimatedTimeSeconds}s)`)

    // ---- 3. Create the order. walletAddress is the payout recipient.
    const order = await bridge.createOrder({
      providerId: quote.provider.id,
      srcChain: quote.srcChain,
      destChain: quote.destChain,
      srcAsset: quote.srcAsset,
      destAsset: quote.destAsset,
      amountIn: quote.amountIn,
      walletAddress: aleoAccount.address,
      quoteId: (quote.quoteId ?? quote.quoteOptionId)!,
      refundAddress: ethAccount.address,
    })

    // Guards before paying: instructions must be satisfiable by a plain
    // ERC-20 transfer, and the order must not already be expired.
    expect(order.depositAddress).toMatch(/^0x/)
    expect(order.depositMemo, 'an EVM deposit cannot carry a memo').toBeFalsy()
    if (order.expiration) expect(new Date(order.expiration).getTime()).toBeGreaterThan(Date.now())

    // ---- 4. Pay the deposit — this is the viem half. USDC has 6 decimals;
    // the instructions' depositAmount is a display-decimal string.
    const before = await publicClient.getBalance({ address: aleoAccount.address })
    const txHash = await evm.writeContract({
      address: USDC_ON_ETHEREUM,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [order.depositAddress as `0x${string}`, parseUnits(order.depositAmount!, route.externalAsset.decimals)],
    })
    console.log(`deposit sent on Ethereum: ${txHash}`)

    // ---- 5. Track to completion. The ALEO arrives as PUBLIC balance.
    const done = await bridge.waitForOrder({
      id: order.orderId,
      onStage: (s) => console.log(`order ${s.orderId}: ${s.status}`),
    })
    expect(done.status).toBe('COMPLETED')

    const after = await publicClient.getBalance({ address: aleoAccount.address })
    console.log(`arrived: ${after - before} microcredits of public ALEO`)

    // ---- 6. The privacy-native coda (optional): shield the arrival into a
    // private record. From here it can fund private DEX swaps
    // (@provablehq/shield-swap-sdk) or a private outbound bridge deposit.
    //
    //   const { walletClient } = aleo.createAleoClient({ ...same config, records: scanner })
    //   await walletClient.transfer({
    //     to: aleoAccount.address,
    //     amount: after - before,
    //     visibility: 'shield',
    //   })
  }, 45 * 60_000)
})
