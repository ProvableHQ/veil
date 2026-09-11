import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi, type Address } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  createAleoClient,
  createBridgeClient,
  createEvmClient,
  evmHttp,
  type BridgeCheckpoint,
} from '../../../../src/index.js'
import { loadLiveState, saveLiveState, waitFor, waitForAleoTransaction } from '../helpers.js'
import { liveStatePath, mainnetCaseEnabled, mainnetExecutionEnabled, required } from '../config.js'

const enabled = mainnetCaseEnabled('aleo-xreserve')
const ERC20_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)'])

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
  it('burns the minimum valid USDCx amount and observes Ethereum delivery', async () => {
    const routeId = 'xreserve:aleo/usdcx->ethereum/usdc'
    const path = liveStatePath('mainnet', 'aleo-xreserve')
    const state = loadLiveState(path, routeId)
    const aleo = await localAleo(required('BRIDGE_PRIVATE_KEY'))
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
      // Circle requires the burn amount to be strictly greater than 2 USDCx.
      amount: '2.000001',
      recipient,
      sender: String(aleo.account.address),
    })

    if (!state.sourceTxId) {
      state.destinationBalanceBefore = (await balanceOf(ethereum.publicClient, token, recipient)).toString()
      saveLiveState(path, state)
      console.table({ route: routeId, amount: plan.amountIn, sender: plan.sender, recipient })
      if (!mainnetExecutionEnabled()) return
      const execution = await bridge.execute({
        plan,
        mode: 'public-as-signer',
        onCheckpoint(checkpoint) {
          state.checkpoint = checkpoint
          state.sourceTxId = checkpoint.source?.transactionId
          saveLiveState(path, state)
        },
      })
      if (execution.kind !== 'aleo-xreserve') throw new Error(`Unexpected execution kind: ${execution.kind}`)
      state.sourceTxId = execution.transactionId
      saveLiveState(path, state)
    }

    await waitForAleoTransaction(aleo.publicClient, state.sourceTxId!)
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

    state.completed = true
    saveLiveState(path, state)
    expect(delivered - before).toBeGreaterThanOrEqual(1_900_001n)
  }, 30 * 60_000)
})
