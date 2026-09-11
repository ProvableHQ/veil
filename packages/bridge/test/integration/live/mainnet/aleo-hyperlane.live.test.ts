import { describe, expect, it } from 'vitest'
import { createAleoClient, createBridgeClient } from '../../../../src/index.js'
import { loadLiveState, saveLiveState, waitForAleoTransaction, waitForHyperlaneDelivery } from '../helpers.js'
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

async function localAleo(privateKey: string) {
  const { loadNetwork } = await import('../../../../../provable-sdk/src/index.js')
  const aleo = await loadNetwork('mainnet')
  return aleo.createAleoClient({
    privateKey,
    networkUrl: 'https://api.provable.com/v2',
    provingMode: 'local',
    confirmationTimeout: 10 * 60_000,
  })
}

describe.skipIf(!enabled)('mainnet Aleo Hyperlane bridge', () => {
  it('moves one atomic unit of the selected asset with a local Aleo account', async () => {
    const routeId = required('BRIDGE_LIVE_ALEO_HYPERLANE_ROUTE_ID')
    const path = liveStatePath('mainnet', 'aleo-hyperlane')
    const state = loadLiveState(path, routeId)
    const aleo = await localAleo(required('BRIDGE_PRIVATE_KEY'))
    const bridge = createBridgeClient({
      clients: { aleo: createAleoClient({ publicClient: aleo.publicClient, account: aleo.walletClient }) },
    })
    const route = bridge.registry.routes.find((candidate) => candidate.id === routeId)
    if (!route) throw new Error(`Unknown configured bridge route: ${routeId}`)
    const source = bridge.registry.assets.find((asset) => asset.id === route.sourceAssetId)
    const destination = bridge.registry.assets.find((asset) => asset.id === route.destinationAssetId)
    if (!source || !destination) throw new Error(`Configured route has unknown assets: ${routeId}`)
    const plan = bridge.prepare({
      source: { chain: source.chainId, asset: source.key },
      destination: { chain: destination.chainId, asset: destination.key },
      bridgeProtocol: route.protocol,
      amount: oneAtomicUnit(source.decimals),
      recipient: required('BRIDGE_LIVE_HYPERLANE_DESTINATION_RECIPIENT'),
      sender: String(aleo.account.address),
    })

    if (!state.sourceTxId) {
      const quote = await bridge.quote({ plan })
      if (quote.kind !== 'aleo-hyperlane') throw new Error(`Unexpected quote kind: ${quote.kind}`)
      const balanceProgram = BALANCE_PROGRAMS[source.key]
      if (!balanceProgram) throw new Error(`No public balance program configured for ${source.id}`)
      const [assetLiteral, creditsBalance] = await Promise.all([
        aleo.publicClient.readContract({ programId: balanceProgram, mapping: 'balances', key: aleo.account.address }),
        aleo.publicClient.getBalance({ address: aleo.account.address }),
      ])
      const assetBalance = unsignedU128(assetLiteral)
      if (assetBalance < 1n) throw new Error(`The bridge account has no public ${source.symbol} atomic units`)
      if (creditsBalance < quote.paymentMicrocredits) {
        throw new Error(`Insufficient credits for Hyperlane hook payment: need ${quote.paymentMicrocredits}, have ${creditsBalance}`)
      }
      console.table({ route: routeId, amount: plan.amountIn, sender: plan.sender, recipient: plan.recipient, assetBalanceAtomic: assetBalance.toString(), creditsBalanceMicrocredits: creditsBalance.toString(), hookPaymentMicrocredits: quote.paymentMicrocredits.toString() })
      if (!mainnetExecutionEnabled()) return
      const execution = await bridge.execute({
        plan,
        mode: 'signer',
        gasPaymentMicrocredits: quote.paymentMicrocredits,
        onCheckpoint(checkpoint) {
          state.checkpoint = checkpoint
          state.sourceTxId = checkpoint.source?.transactionId
          saveLiveState(path, state)
        },
      })
      if (execution.kind !== 'aleo-hyperlane') throw new Error(`Unexpected execution kind: ${execution.kind}`)
      state.sourceTxId = execution.transactionId
      saveLiveState(path, state)
    }

    await waitForAleoTransaction(aleo.publicClient, state.sourceTxId!)
    const delivery = await waitForHyperlaneDelivery(state.sourceTxId!)
    state.messageId = delivery.messageId
    state.destinationTxId = delivery.destinationTxId
    state.completed = true
    saveLiveState(path, state)
    expect(state).toMatchObject({ completed: true, messageId: expect.any(String), destinationTxId: expect.any(String) })
  }, 30 * 60_000)
})
