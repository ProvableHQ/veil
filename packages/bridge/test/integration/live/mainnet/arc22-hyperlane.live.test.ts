import { describe, expect, it } from 'vitest'
import { createPublicClient, http, parseAbi, type Address } from 'viem'
import { getBase58Decoder } from '@solana/kit'
import { ARC22_ROUTES, runArc22Example } from '../../../../examples/arc22-hyperlane.js'
import { createPublicClient as createAleoPublicClient, http as aleoHttp } from '@provablehq/veil-core'
import splFixture from '../../../fixtures/sealevel-spl-collateral-transfer-remote.json'
import { createBridgeClient, createAleoClient, createSolanaClient, solanaHttp, DEFAULT_BRIDGE_REGISTRY } from '../../../../src/index.js'
import { liveStatePath, mainnetCaseEnabled, mainnetExecutionEnabled, required } from '../config.js'

const readOnly = process.env.BRIDGE_ARC22_READ_ONLY === '1'
const addresses = {
  aleo: 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n',
  ethereum: '0x0000000000000000000000000000000000000001',
  solana: 'D4jZ2sNktKgTrhWVMnjZb5BXP7MMh9N3y5ZLwkyKfozb',
} as const

// No secrets, signers, broadcasts, or mocked transports in this suite.
describe.skipIf(!readOnly)('ARC-22 live read-only quotes', () => {
  it.each(ARC22_ROUTES)('quotes %s using deployed fee configuration', async routeId => {
    const route = DEFAULT_BRIDGE_REGISTRY.routes.find(entry => entry.id === routeId)!
    const source = DEFAULT_BRIDGE_REGISTRY.assets.find(entry => entry.id === route.sourceAssetId)!
    const destination = DEFAULT_BRIDGE_REGISTRY.assets.find(entry => entry.id === route.destinationAssetId)!
    const quote = await runArc22Example({ routeId, amount: '0.0001',
      sender: addresses[source.chainId as keyof typeof addresses],
      recipient: addresses[destination.chainId as keyof typeof addresses], execute: false })
    if (!('kind' in quote)) throw new Error('Expected quote without execution')
    expect(quote.plan.route.id).toBe(routeId)
    if (quote.kind === 'solana-hyperlane') {
      expect(quote.igpPaymentLamports).toBeGreaterThan(0n)
      expect(quote.networkFeeLamports).toBeGreaterThan(0n)
      expect(quote.totalLamports).toBe(quote.igpPaymentLamports + quote.networkFeeLamports + quote.rentLamports)
      expect(quote.amountLamports).toBe(10n ** BigInt(source.decimals - 4))
    } else if (quote.kind === 'evm-hyperlane') {
      expect(quote.tokenAddress?.toLowerCase()).toBe(source.locator!.value.toLowerCase())
      expect(quote.nativeFeeAtomic).toBeGreaterThan(0n)
    } else if (quote.kind === 'aleo-hyperlane') {
      expect(quote.paymentMicrocredits).toBeGreaterThan(0n)
    } else throw new Error(`Unexpected quote: ${quote.kind}`)
  }, 90_000)
})

const abi = parseAbi(['function decimals() view returns (uint8)', 'function wrappedToken() view returns (address)'])
describe.skipIf(!readOnly)('ARC-22 deployed collateral', () => {
  it.each(['bat', 'usdg'])('checks Ethereum %s collateral and decimals', async asset => {
    const route = DEFAULT_BRIDGE_REGISTRY.routes.find(entry => entry.id === `hyperlane:ethereum/${asset}->aleo/${asset}`)!
    const source = DEFAULT_BRIDGE_REGISTRY.assets.find(entry => entry.id === route.sourceAssetId)!
    const rpc = createPublicClient({ transport: http(process.env.BRIDGE_LIVE_ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com', { timeout: 20_000, retryCount: 0 }) })
    expect(await rpc.getChainId()).toBe(1)
    const router = route.metadata!.routerAddress as Address
    expect(await rpc.getCode({ address: router })).toMatch(/^0x[0-9a-f]+$/i)
    expect((await rpc.readContract({ address: router, abi, functionName: 'wrappedToken' })).toLowerCase()).toBe(source.locator!.value.toLowerCase())
    expect(await rpc.readContract({ address: source.locator!.value as Address, abi, functionName: 'decimals' })).toBe(source.decimals)
  }, 90_000)

  it.each(['bat', 'usdg', 'zec'])('checks Solana %s program, mint owner, decimals, and escrow', async asset => {
    const route = DEFAULT_BRIDGE_REGISTRY.routes.find(entry => entry.id === `hyperlane:solana/${asset}->aleo/${asset}`)!
    const source = DEFAULT_BRIDGE_REGISTRY.assets.find(entry => entry.id === route.sourceAssetId)!
    const meta = route.metadata!
    const response = await fetch(process.env.BRIDGE_LIVE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [
        [meta.warpProgramAddress, meta.tokenPda, meta.collateralMintAddress, meta.escrowPda], { encoding: 'base64', commitment: 'confirmed' },
      ] }),
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.error).toBeUndefined()
    const [program, token, mint, escrow] = body.result.value
    expect(program?.executable).toBe(true)
    expect(token?.owner).toBe(meta.warpProgramAddress)
    expect(mint?.owner).toBe(meta.splTokenProgramAddress)
    expect(escrow?.owner).toBe(meta.splTokenProgramAddress)
    const mintData = Buffer.from(mint.data[0], 'base64')
    const escrowData = Buffer.from(escrow.data[0], 'base64')
    expect(mintData.length).toBeGreaterThanOrEqual(82)
    expect(mintData[44]).toBe(source.decimals)
    expect(mintData[45]).toBe(1) // initialized mint
    expect(escrowData.length).toBeGreaterThanOrEqual(165)
    expect(getBase58Decoder().decode(escrowData.subarray(0, 32))).toBe(meta.collateralMintAddress)
  }, 60_000)
})

// Every directed route has an explicit case. Selecting one cannot spend on the others.
// A preflight-only run is not reported as a passing fund-moving test.
describe('ARC-22 live transfer and recovery', () => {
  const enabled = mainnetCaseEnabled('arc22-hyperlane') && mainnetExecutionEnabled()
  if (enabled && !ARC22_ROUTES.some(id => id === process.env.BRIDGE_ARC22_ROUTE_ID)) throw new Error('Select one supported BRIDGE_ARC22_ROUTE_ID')
  for (const routeId of ARC22_ROUTES) it.skipIf(!enabled || process.env.BRIDGE_ARC22_ROUTE_ID !== routeId)(routeId, async () => {
    const progress = await runArc22Example({ routeId, amount: required('BRIDGE_ARC22_AMOUNT'),
      sender: required('BRIDGE_ARC22_SENDER'), recipient: required('BRIDGE_ARC22_RECIPIENT'), execute: true,
      statePath: liveStatePath('mainnet', routeId.replace(/[^a-z0-9]+/gi, '-')) })
    if (!('next' in progress)) throw new Error('Live transfer stopped at a quote')
    expect(progress.next).toBe('done')
    expect(progress.receipt.status).toBe('COMPLETED')
    expect(progress.receipt.sourceTxId).toBeTruthy()
  }, 30 * 60_000)
})


describe.skipIf(!readOnly)('ARC-22 historical live recovery', () => {
  it('recovers the observed ZEC deposit and verifies canonical Aleo delivery without a signer', async () => {
    const bridge = createBridgeClient({ environment: 'mainnet', clients: {
      solana: createSolanaClient({ transport: solanaHttp(process.env.BRIDGE_LIVE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com') }),
      aleo: createAleoClient({ publicClient: createAleoPublicClient({ transport: aleoHttp(process.env.ALEO_RPC_URL || 'https://edge.provable.com/api/v2', { network: 'mainnet' }) }) }),
    } })
    let progress = await bridge.recover({ checkpoint: {
      version: 1,
      route: { id: 'hyperlane:solana/zec->aleo/zec', registryVersion: DEFAULT_BRIDGE_REGISTRY.version },
      intent: { source: { chain: 'solana', asset: 'zec' }, destination: { chain: 'aleo', asset: 'zec' },
        bridgeProtocol: 'hyperlane', amount: '0.0001', sender: splFixture.senderAddress, recipient: splFixture.recipientAleoAddress },
      source: { transactionId: splFixture.signature },
    } })
    if (progress.next === 'wait') progress = await bridge.wait({ progress, timeoutMs: 45_000, pollingIntervalMs: 2_000 })
    expect(progress.next).toBe('done')
    expect(progress.receipt.sourceTxId).toBe(splFixture.signature)
    expect(progress.receipt.messageId).toBe(splFixture.source.split('/').at(-1))
    expect(progress.receipt.status).toBe('COMPLETED')
  }, 60_000)
})
