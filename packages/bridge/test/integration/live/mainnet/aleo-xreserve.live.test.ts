import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi, type Address } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  createAleoClient,
  createBridgeClient,
  createEvmClient,
  evmHttp,
  type BridgeCheckpoint,
} from '../../../../src/index.js'
import { createLiveBenchmark, loadLiveState, saveLiveState, waitFor, waitForAleoTransaction } from '../helpers.js'
import { liveStatePath, mainnetCaseEnabled, mainnetExecutionEnabled, required } from '../config.js'

const enabled = mainnetCaseEnabled('aleo-xreserve')
const ERC20_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)'])

async function delegatedAleo(privateKey: string, apiKey: string) {
  const { loadNetwork } = await import('../../../../../provable-sdk/src/index.js')
  const aleo = await loadNetwork('mainnet')
  const auth = { mode: 'api-key' as const, value: apiKey }
  const records = aleo.createRemoteScanner({
    url: 'https://edge.provable.com/api/scanner',
    auth,
  })
  return aleo.createAleoClient({
    privateKey,
    networkUrl: 'https://edge.provable.com/api/v2',
    proverUrl: 'https://edge.provable.com/api/prove',
    provingMode: 'delegated',
    auth,
    records,
    confirmationTimeout: 10 * 60_000,
  })
}

const EMPTY_MERKLE_PROOF = `{ siblings: [${Array(16).fill('0field').join(', ')}], leaf_index: 1u32 }`
const EMPTY_MERKLE_PROOFS = `[${EMPTY_MERKLE_PROOF}, ${EMPTY_MERKLE_PROOF}]`
const BURN_AMOUNT_ATOMIC = 2_000_001n
const EXPECTED_DELIVERY_ATOMIC = 1n

async function selectUsdcxRecord(client: Awaited<ReturnType<typeof delegatedAleo>>['walletClient']): Promise<string> {
  const records = await client.requestRecords({
    program: 'usdcx_stablecoin.aleo',
    statusFilter: 'unspent',
  })
  const candidates = records.flatMap((record) => {
    if (!('recordPlaintext' in record)) return []
    const amount = record.recordPlaintext.match(/\bamount:\s*(\d+)u128(?:\.private)?/i)?.[1]
    if (!amount || BigInt(amount) < BURN_AMOUNT_ATOMIC) return []
    return [{ amount: BigInt(amount), plaintext: record.recordPlaintext }]
  })
  candidates.sort((left, right) => left.amount < right.amount ? -1 : left.amount > right.amount ? 1 : 0)
  const selected = candidates[0]
  if (!selected) throw new Error(`No unspent private USDCx record covers ${BURN_AMOUNT_ATOMIC}`)
  return selected.plaintext
}

async function balanceOf(
  client: ReturnType<typeof createEvmClient>['publicClient'],
  token: Address,
  owner: Address,
): Promise<bigint> {
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] })
  const result = await client.call({ to: token, data })
  return decodeFunctionResult({ abi: ERC20_ABI, functionName: 'balanceOf', data: result })
}

describe.skipIf(!enabled)('mainnet Aleo xReserve bridge', () => {
  it('privately burns the minimum valid USDCx amount and observes Ethereum delivery', async () => {
    const routeId = 'xreserve:aleo/usdcx->ethereum/usdc'
    const path = liveStatePath('mainnet', 'aleo-xreserve')
    const state = loadLiveState(path, routeId)
    const benchmark = createLiveBenchmark('aleo-xreserve')
    const aleo = await delegatedAleo(
      required('BRIDGE_PRIVATE_KEY'),
      required('EDGE_PROVABLE_API_KEY'),
    )
    benchmark.mark('aleo-client-ready')
    const ethereum = createEvmClient({ transport: evmHttp(required('BRIDGE_LIVE_ETHEREUM_RPC_URL')) })
    const recipient = getAddress(required('BRIDGE_LIVE_ETHEREUM_RECIPIENT'))
    const bridge = createBridgeClient({
      environment: 'mainnet',
      clients: {
        aleo: createAleoClient({ publicClient: aleo.publicClient, account: aleo.walletClient }),
        ethereum,
      },
    })
    const usdc = bridge.registry.assets.find((asset) => asset.id === 'ethereum/usdc')
    if (usdc?.locator?.kind !== 'evm-contract') throw new Error('Ethereum USDC contract is missing')
    const token = getAddress(usdc.locator.value)
    const plan = bridge.prepare({
      source: { chain: 'aleo', asset: 'usdcx' },
      destination: { chain: 'ethereum', asset: 'usdc' },
      bridgeProtocol: 'xreserve',
      // The deployed bridge deducts 2 USDC; one extra atomic unit exercises
      // the lowest valid burn while still producing a destination transfer.
      amount: '2.000001',
      recipient,
      sender: String(aleo.account.address),
    })
    const quote = await bridge.quote({ plan })
    if (quote.kind !== 'aleo-xreserve' || quote.amountOut !== '0.000001') {
      throw new Error('Aleo xReserve quote does not match the deployed withdrawal fee')
    }
    benchmark.mark('quote-ready')

    if (!state.sourceTxId) {
      state.destinationBalanceBefore = (await balanceOf(ethereum.publicClient, token, recipient)).toString()
      benchmark.mark('destination-balance-ready')
      saveLiveState(path, state)
      console.table({ route: routeId, amount: plan.amountIn, sender: plan.sender, recipient })
      if (!mainnetExecutionEnabled()) return
      const userRecord = await selectUsdcxRecord(aleo.walletClient)
      benchmark.mark('private-record-selected')
      const execution = await bridge.execute({
        plan,
        mode: 'private',
        userRecord,
        merkleProof: EMPTY_MERKLE_PROOFS,
        onProgress(event) {
          benchmark.mark(event.type)
        },
        onCheckpoint(checkpoint) {
          state.checkpoint = checkpoint
          state.sourceTxId = checkpoint.source?.transactionId
          saveLiveState(path, state)
          benchmark.mark('checkpoint-saved')
        },
      })
      benchmark.mark('execute-returned')
      if (execution.kind !== 'aleo-xreserve') throw new Error(`Unexpected execution kind: ${execution.kind}`)
      state.sourceTxId = execution.transactionId
      saveLiveState(path, state)
    }

    await waitForAleoTransaction(aleo.publicClient, state.sourceTxId!)
    benchmark.mark('source-confirmed')
    const recoveryBridge = createBridgeClient({
      environment: 'mainnet',
      clients: {
        aleo: createAleoClient({ publicClient: aleo.publicClient }),
        ethereum,
      },
    })
    await recoveryBridge.recover({ checkpoint: state.checkpoint as BridgeCheckpoint })
    const before = BigInt(state.destinationBalanceBefore!)
    const delivered = await waitFor(async () => {
      const balance = await balanceOf(ethereum.publicClient, token, recipient)
      return balance > before ? balance : undefined
    })
    benchmark.mark('destination-delivered')

    state.completed = true
    saveLiveState(path, state)
    expect(delivered - before).toBe(EXPECTED_DELIVERY_ATOMIC)
  }, 30 * 60_000)
})
