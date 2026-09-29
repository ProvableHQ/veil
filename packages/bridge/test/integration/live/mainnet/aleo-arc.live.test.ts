import { createPublicClient, getAddress, http, parseAbi, parseAbiItem, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { createAleoClient, createBridgeClient, type BridgeCheckpoint } from '../../../../src/index.js'
import { liveStatePath, mainnetCaseEnabled, mainnetExecutionEnabled, required, requiredEvmPrivateKey } from '../config.js'
import { createLiveBenchmark, loadLiveState, saveLiveState, waitFor, waitForAleoTransaction } from '../helpers.js'

const enabled = mainnetCaseEnabled('aleo-arc')
const TOKEN = '0x3600000000000000000000000000000000000000'
const ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)'])
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

// Generate a current exclusion witness; a hardcoded empty-tree proof is invalid
// once the deployed freeze-list root changes.
async function exclusionProof(address: string): Promise<string> {
  const response = await fetch('https://edge.provable.com/api/v2/mainnet/programs/usdcx_freezelist.aleo/compliance/freeze-list')
  if (!response.ok) throw new Error(`Freeze-list request failed: ${response.status}`)
  const data: unknown = await response.json()
  if (!Array.isArray(data) || !data.length || data.some(value => typeof value !== 'string' || !/^\d+$/.test(value))) {
    throw new Error('Invalid freeze-list response')
  }
  const { SealanceMerkleTree } = await import('@provablehq/sdk/mainnet.js')
  const merkle = new SealanceMerkleTree()
  const tree = merkle.convertTreeToBigInt(data)
  const [left, right] = merkle.getLeafIndices(tree, address)
  return merkle.formatMerkleProof([merkle.getSiblingPath(tree, left, 16), merkle.getSiblingPath(tree, right, 16)])
}

describe.skipIf(!enabled)('mainnet Aleo to Arc xReserve', () => {
  it('burns private USDCx and verifies Arc USDC delivery without an Arc signer', async () => {
    const routeId = 'xreserve:aleo/usdcx->arc/usdc'
    const path = liveStatePath('mainnet', 'aleo-arc')
    const state = loadLiveState(path, routeId)
    // Retain timing and block boundaries across process restarts.
    const saved = state as typeof state & { startBlock?: string, startedAt?: number, submittedAt?: number, deliveredAt?: number, expectedAtomic?: string }
    if (state.completed) {
      expect(state.sourceTxId).toBeTruthy()
      expect(state.destinationTxId).toBeTruthy()
      return
    }
    const benchmark = createLiveBenchmark('aleo-arc')
    const recipient = getAddress(process.env.BRIDGE_LIVE_ARC_RECIPIENT?.trim()
      || privateKeyToAccount(requiredEvmPrivateKey('BRIDGE_EVM_PRIVATE_KEY')).address)
    const arc = createPublicClient({ transport: http(process.env.BRIDGE_LIVE_ARC_RPC_URL?.trim() || 'https://rpc.mainnet.arc.io') })
    expect(await arc.getChainId()).toBe(5042)
    const { loadNetwork } = await import('../../../../../provable-sdk/src/index.js')
    const sdk = await loadNetwork('mainnet')
    const key = process.env.EDGE_PROVABLE_API_KEY?.trim()
    const auth = key ? { mode: 'api-key' as const, value: key } : undefined
    const aleo = sdk.createAleoClient({
      privateKey: required('BRIDGE_PRIVATE_KEY'), provingMode: 'delegated', auth,
      records: sdk.createRemoteScanner({ url: 'https://edge.provable.com/api/scanner', auth }),
      confirmationTimeout: 10 * 60_000,
    })
    // Enforce the test budget on both quote and execution-time refresh. The
    // program has no on-chain fee cap, so provider settlement remains external.
    const budgetedFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init)
      if (String(input) === 'https://api.usdcx.aleo.org/api/estimate-burn-fee' && response.ok) {
        const body = await response.clone().json() as { withdrawalFeeBaseUnits?: unknown }
        const fee = body.withdrawalFeeBaseUnits
        if (typeof fee !== 'string' || !/^\d+$/.test(fee) || BigInt(fee) > 100_000n) throw new Error('Withdrawal estimate exceeds the live-test fee budget')
        saved.expectedAtomic = (2_000_000n - BigInt(fee)).toString()
        if (saved.startedAt) saveLiveState(path, saved)
      }
      return response
    }
    const bridge = createBridgeClient({ environment: 'mainnet', fetch: budgetedFetch, clients: {
      aleo: createAleoClient({ publicClient: aleo.publicClient, account: aleo.walletClient }),
    } })
    const persist = (checkpoint: BridgeCheckpoint) => {
      saved.checkpoint = checkpoint
      saved.sourceTxId = checkpoint.source?.transactionId ?? saved.sourceTxId
      if (saved.sourceTxId && !saved.submittedAt) saved.submittedAt = Date.now()
      saveLiveState(path, saved)
      benchmark.mark('checkpoint-saved')
    }
    if (!state.checkpoint) {
      const quote = await bridge.quote({
        source: { chain: 'aleo', asset: 'usdcx' }, destination: { chain: 'arc', asset: 'usdc' },
        amount: '2', sender: String(aleo.account.address), recipient,
      })
      if (quote.kind !== 'aleo-xreserve' || !quote.amountOut) throw new Error('Missing withdrawal quote')
      const expected = parseUnits(quote.amountOut, 6)
      // The approved test burns only two USDCx and rejects a fee above 0.10 USDC.
      expect(expected).toBeGreaterThanOrEqual(1_900_000n)
      console.table({ route: routeId, amount: '2', estimatedDelivery: quote.amountOut, recipient })
      if (!mainnetExecutionEnabled()) return
      const records = await aleo.walletClient.requestRecords({ program: 'usdcx_stablecoin.aleo', statusFilter: 'unspent' })
      const record = records.find(value => 'recordPlaintext' in value && typeof value.recordPlaintext === 'string'
        && BigInt(value.recordPlaintext.match(/\bamount:\s*(\d+)u128/)?.[1] ?? '0') === 2_000_000n)
      if (!record || !('recordPlaintext' in record) || typeof record.recordPlaintext !== 'string') throw new Error('No unspent two-USDCx private record; no burn submitted')
      const merkleProof = await exclusionProof(String(aleo.account.address))
      saved.destinationBalanceBefore = (await arc.readContract({ address: TOKEN, abi: ABI, functionName: 'balanceOf', args: [recipient] })).toString()
      saved.startBlock = (await arc.getBlockNumber()).toString()
      saved.expectedAtomic = expected.toString()
      saved.startedAt = Date.now()
      saveLiveState(path, saved)
      const result = await bridge.execute({
        plan: quote.plan, userRecord: record.recordPlaintext, merkleProof,
        onCheckpoint: persist, onProgress(event) { benchmark.mark(event.type) },
      })
      if (result.kind !== 'aleo-xreserve') throw new Error('Unexpected execution kind')
      benchmark.mark('burn-submitted')
    } else {
      const progress = await bridge.recover({ checkpoint: state.checkpoint as BridgeCheckpoint })
      if (progress.next === 'failed') throw new Error(progress.error)
      if (progress.next === 'resume') {
        if (!mainnetExecutionEnabled()) return
        await bridge.resume({ progress, onCheckpoint: persist })
      }
    }
    if (!saved.sourceTxId || !saved.startBlock || !saved.expectedAtomic || !saved.destinationBalanceBefore) throw new Error('Incomplete saved withdrawal state')
    await waitForAleoTransaction(aleo.publicClient, saved.sourceTxId)
    benchmark.mark('burn-confirmed')
    const before = BigInt(saved.destinationBalanceBefore)
    const expected = BigInt(saved.expectedAtomic)
    const delivery = await waitFor(async () => {
      const logs = await arc.getLogs({ address: TOKEN, event: TRANSFER, args: { to: recipient }, fromBlock: BigInt(saved.startBlock!), toBlock: 'latest' })
      return logs.find(log => log.args.value === expected)
    })
    const receipt = await arc.getTransactionReceipt({ hash: delivery.transactionHash })
    expect(receipt.status).toBe('success')
    expect(await arc.readContract({ address: TOKEN, abi: ABI, functionName: 'balanceOf', args: [recipient] }) - before).toBe(expected)
    saved.destinationTxId = delivery.transactionHash
    saved.deliveredAt = Date.now()
    saved.completed = true
    saveLiveState(path, saved)
    benchmark.mark('arc-delivered')
    console.table({ sourceTxId: saved.sourceTxId, destinationTxId: saved.destinationTxId,
      deliveredAtomic: expected.toString(), elapsedMs: saved.deliveredAt - saved.startedAt! })
  }, 30 * 60_000)
})
