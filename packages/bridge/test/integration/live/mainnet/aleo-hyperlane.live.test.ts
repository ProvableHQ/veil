import { describe, expect, it } from 'vitest'
import {
  createAleoClient,
  createBridgeClient,
  createEvmClient,
  createSolanaClient,
  DEFAULT_BRIDGE_REGISTRY,
  evmHttp,
  parseDecimalAmount,
  solanaHttp,
  type BridgeChainClient,
  type BridgeCheckpoint,
} from '../../../../src/index.js'
import { createLiveBenchmark, loadLiveState, saveLiveState, waitForAleoTransaction } from '../helpers.js'
import { liveStatePath, mainnetCaseEnabled, mainnetExecutionEnabled, oneAtomicUnit, required } from '../config.js'

const enabled = mainnetCaseEnabled('aleo-hyperlane')
const BALANCE_PROGRAMS: Readonly<Record<string, string>> = {
  eth: 'arc20_eth.aleo',
  sol: 'arc20_sol.aleo',
  usdt: 'arc20_usdt.aleo',
  wbtc: 'arc20_wbtc.aleo',
}

function unsignedU128(value: string | null): bigint {
  const match = value?.trim().match(/^(0|[1-9][0-9]*)u128$/)
  if (!match) return 0n
  return BigInt(match[1]!)
}

async function delegatedAleo(privateKey: string, apiKey: string) {
  const { loadNetwork } = await import('../../../../../provable-sdk/src/index.js')
  const aleo = await loadNetwork('mainnet')
  return aleo.createAleoClient({
    privateKey,
    networkUrl: 'https://edge.provable.com/api/v2',
    proverUrl: 'https://edge.provable.com/api/prove',
    provingMode: 'delegated',
    auth: { mode: 'api-key', value: apiKey },
    confirmationTimeout: 10 * 60_000,
  })
}

describe.skipIf(!enabled)('mainnet Aleo Hyperlane bridge', () => {
  it('moves the configured amount of the selected asset with a local Aleo account', async () => {
    const routeId = required('BRIDGE_LIVE_ALEO_HYPERLANE_ROUTE_ID')
    const stateName = `aleo-hyperlane-${routeId.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`
    const path = liveStatePath('mainnet', stateName)
    const state = loadLiveState(path, routeId)
    const benchmark = createLiveBenchmark('aleo-hyperlane')
    if (state.completed) {
      expect(state.sourceTxId).toEqual(expect.any(String))
      return
    }
    console.log('[aleo-hyperlane] loading delegated Aleo client')
    const aleo = await delegatedAleo(
      required('BRIDGE_PRIVATE_KEY'),
      required('EDGE_PROVABLE_API_KEY'),
    )
    benchmark.mark('client-ready')
    console.log('[aleo-hyperlane] delegated Aleo client ready')
    const route = DEFAULT_BRIDGE_REGISTRY.routes.find((candidate) => candidate.id === routeId)
    if (!route) throw new Error(`Unknown configured bridge route: ${routeId}`)
    const source = DEFAULT_BRIDGE_REGISTRY.assets.find((asset) => asset.id === route.sourceAssetId)
    const destination = DEFAULT_BRIDGE_REGISTRY.assets.find((asset) => asset.id === route.destinationAssetId)
    if (!source || !destination) throw new Error(`Configured route has unknown assets: ${routeId}`)
    const destinationChain = DEFAULT_BRIDGE_REGISTRY.chains.find((chain) => chain.id === destination.chainId)
    if (!destinationChain) throw new Error(`Configured route has unknown destination chain: ${routeId}`)
    let destinationClient: BridgeChainClient
    if (destinationChain.family === 'evm') {
      destinationClient = createEvmClient({ transport: evmHttp(required('BRIDGE_LIVE_ETHEREUM_RPC_URL')) })
    } else if (destinationChain.family === 'solana') {
      destinationClient = createSolanaClient({ transport: solanaHttp(required('BRIDGE_LIVE_SOLANA_RPC_URL')) })
    } else {
      throw new Error(`Aleo Hyperlane live test cannot verify destination family ${destinationChain.family}`)
    }
    const bridge = createBridgeClient({
      clients: {
        aleo: createAleoClient({ publicClient: aleo.publicClient, account: aleo.walletClient }),
        [destination.chainId]: destinationClient,
      },
    })
    const amount = process.env.BRIDGE_LIVE_ALEO_HYPERLANE_AMOUNT?.trim()
      || oneAtomicUnit(source.decimals)
    const amountAtomic = parseDecimalAmount(amount, source.decimals)
    const plan = bridge.prepare({
      source: { chain: source.chainId, asset: source.key },
      destination: { chain: destination.chainId, asset: destination.key },
      bridgeProtocol: route.protocol,
      amount,
      recipient: required('BRIDGE_LIVE_HYPERLANE_DESTINATION_RECIPIENT'),
      sender: String(aleo.account.address),
    })

    if (!state.sourceTxId) {
      console.log('[aleo-hyperlane] reading Hyperlane gas quote')
      const quote = await bridge.quote({ plan })
      benchmark.mark('quote-ready')
      console.log('[aleo-hyperlane] Hyperlane gas quote ready')
      if (quote.kind !== 'aleo-hyperlane') throw new Error(`Unexpected quote kind: ${quote.kind}`)
      const executionFeeLiteral = process.env.BRIDGE_LIVE_ALEO_EXECUTION_FEE_MICROCREDITS?.trim() ?? '0'
      if (!/^\d+$/.test(executionFeeLiteral)) {
        throw new Error('BRIDGE_LIVE_ALEO_EXECUTION_FEE_MICROCREDITS must be an unsigned integer')
      }
      const executionFeeMicrocredits = BigInt(executionFeeLiteral)
      const executeMainnet = mainnetExecutionEnabled()
      if (executeMainnet && executionFeeMicrocredits === 0n) {
        throw new Error('Mainnet Aleo Hyperlane execution requires BRIDGE_LIVE_ALEO_EXECUTION_FEE_MICROCREDITS from a prior matching transaction')
      }
      const balanceProgram = BALANCE_PROGRAMS[source.key]
      if (!balanceProgram) throw new Error(`No public balance program configured for ${source.id}`)
      console.log('[aleo-hyperlane] reading source asset and credits balances')
      const [assetLiteral, creditsBalance] = await Promise.all([
        aleo.publicClient.readContract({ programId: balanceProgram, mapping: 'balances', key: aleo.account.address }),
        aleo.publicClient.getBalance({ address: aleo.account.address }),
      ])
      benchmark.mark('balances-ready')
      console.log('[aleo-hyperlane] source asset and credits balances ready')
      const assetBalance = unsignedU128(assetLiteral)
      if (assetBalance < amountAtomic) {
        throw new Error(`Insufficient public ${source.symbol}: need ${amountAtomic} atomic units, have ${assetBalance}`)
      }
      const requiredCredits = quote.paymentMicrocredits + executionFeeMicrocredits
      if (creditsBalance < requiredCredits) {
        throw new Error(`Insufficient credits for Hyperlane hook and execution fee: need ${requiredCredits}, have ${creditsBalance}`)
      }
      console.table({ route: routeId, amount: plan.amountIn, sender: plan.sender, recipient: plan.recipient, assetBalanceAtomic: assetBalance.toString(), creditsBalanceMicrocredits: creditsBalance.toString(), hookPaymentMicrocredits: quote.paymentMicrocredits.toString(), executionFeeMicrocredits: executionFeeMicrocredits.toString(), requiredCreditsMicrocredits: requiredCredits.toString() })
      if (!executeMainnet) return
      const execution = await bridge.execute({
        plan,
        mode: 'signer',
        gasPaymentMicrocredits: quote.paymentMicrocredits,
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
      if (execution.kind !== 'aleo-hyperlane') throw new Error(`Unexpected execution kind: ${execution.kind}`)
      state.sourceTxId = execution.transactionId
      saveLiveState(path, state)
    }

    await waitForAleoTransaction(aleo.publicClient, state.sourceTxId!)
    benchmark.mark('source-confirmed')
    if (!state.checkpoint) throw new Error('Aleo Hyperlane source has no recovery checkpoint')
    let progress = await bridge.recover({ checkpoint: state.checkpoint as BridgeCheckpoint })
    if (progress.next === 'wait') progress = await bridge.wait({ progress })
    if (progress.next === 'failed') throw new Error(progress.error)
    if (progress.next !== 'done') throw new Error(`Expected completed Aleo Hyperlane delivery, received ${progress.next}`)
    benchmark.mark('destination-delivered')
    state.completed = true
    saveLiveState(path, state)
    expect(state).toMatchObject({ completed: true, sourceTxId: expect.any(String) })
  }, 30 * 60_000)
})
