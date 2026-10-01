import { createPublicClient, createWalletClient, formatUnits, http, parseAbi, slice, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, mainnet } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import {
  createBridgeCheckpoint, createBridgeClient, createEvmClient, evmHttp, evmPrivateKey,
  type BridgeCheckpoint, type EvmClient,
} from '../../../../src/index.js'
import { liveStatePath, mainnetCaseEnabled, mainnetExecutionEnabled, requiredEvmPrivateKey } from '../config.js'
import { loadLiveState, saveLiveState } from '../helpers.js'

const ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)'])
const networks = {
  ethereum: { chain: mainnet, rpc: 'https://ethereum-rpc.publicnode.com', amount: '2.75', maxFee: '2.7' },
  base: { chain: base, rpc: 'https://mainnet.base.org', amount: '0.25', maxFee: '0.1' },
  arbitrum: { chain: arbitrum, rpc: 'https://arb1.arbitrum.io/rpc', amount: '0.25', maxFee: '0.15' },
} as const

type LegState = ReturnType<typeof loadLiveState> & {
  startedAt?: number
  deliveredAt?: number
  deliveredAtomic?: string
}

for (const destination of ['ethereum', 'base', 'arbitrum'] as const) {
  const scenario = networks[destination]
  const caseName = `cctp-roundtrip-${destination}`
  describe.skipIf(!mainnetCaseEnabled(caseName))(`mainnet Arc to ${destination} roundtrip`, () => {
    it('verifies both CCTP deliveries and returns only the received USDC', async () => {
      const key = requiredEvmPrivateKey('BRIDGE_EVM_PRIVATE_KEY')
      const account = privateKeyToAccount(key)
      const arcRpc = process.env.BRIDGE_LIVE_ARC_RPC_URL?.trim() || 'https://rpc.mainnet.arc.io'
      const destinationRpc = process.env[`BRIDGE_LIVE_${destination.toUpperCase()}_RPC_URL`]?.trim() || scenario.rpc
      const destinationPublic = createPublicClient({ transport: http(destinationRpc) })
      const arcPublic = createPublicClient({ transport: http(arcRpc) })
      expect(await arcPublic.getChainId()).toBe(5042)
      expect(await destinationPublic.getChainId()).toBe(scenario.chain.id)
      const destinationWallet = createWalletClient({ account, chain: scenario.chain, transport: http(destinationRpc) })
      const target = createEvmClient({ transport: evmHttp(destinationRpc) })
      target.walletClient = {
        getAddress: async () => account.address,
        sendTransaction: async ({ chainId, from, to, data, value }) => {
          if (chainId !== scenario.chain.id || await destinationPublic.getChainId() !== chainId
            || (from && from.toLowerCase() !== account.address.toLowerCase())) throw new Error('Roundtrip signer or network mismatch')
          // Explicit mainnet priority fees avoid RPC-filled zero-tip transactions.
          return destinationWallet.sendTransaction({ to, data, value,
            ...(destination === 'ethereum' ? { maxPriorityFeePerGas: 1_000_000_000n } : {}),
          })
        },
      }
      const arc = createEvmClient({ transport: evmHttp(arcRpc), account: evmPrivateKey(key) })
      const clients: Record<string, EvmClient> = { arc, [destination]: target }
      const bridge = createBridgeClient({ environment: 'mainnet', clients })
      const recovery = createBridgeClient({ environment: 'mainnet', clients: {
        arc: { family: 'evm', publicClient: arc.publicClient },
        [destination]: { family: 'evm', publicClient: target.publicClient },
      } })
      async function leg(source: string, to: string, amount: string, maxFee: string): Promise<string | undefined> {
        const routeId = `cctp:${source}/usdc->${to}/usdc`
        const path = liveStatePath('mainnet', `${caseName}-${source === 'arc' ? 'outbound' : 'return'}`)
        const state = loadLiveState(path, routeId) as LegState
        const persist = (checkpoint: BridgeCheckpoint) => {
          state.checkpoint = checkpoint
          state.sourceTxId = checkpoint.source?.transactionId ?? state.sourceTxId
          state.destinationTxId = checkpoint.destination?.transactionId ?? state.destinationTxId
          saveLiveState(path, state)
        }
        if (state.completed) {
          const verified = await recovery.recover({ checkpoint: state.checkpoint as BridgeCheckpoint })
          expect(verified.next).toBe('done')
          if (!state.deliveredAtomic) throw new Error('Completed leg is missing its received amount')
          return formatUnits(BigInt(state.deliveredAtomic), 6)
        }
        const asset = bridge.registry.assets.find(entry => entry.id === `${to}/usdc`)!
        const token = asset.locator!.value as Address
        const destinationReader = to === 'arc' ? arcPublic : destinationPublic
        if (!state.checkpoint) {
          // New outbound transfers require return gas; submitted or completed
          // legs must remain recoverable even if that gas has since been spent.
          if (mainnetExecutionEnabled() && await destinationPublic.getBalance({ address: account.address }) === 0n) {
            throw new Error(`Fund the test account with native gas on ${destination} before starting a new leg`)
          }
          if (state.sourceTxId) throw new Error('Missing checkpoint for an existing burn; refusing a new transfer')
          const quote = await bridge.quote({
            source: { chain: source, asset: 'usdc' }, destination: { chain: to, asset: 'usdc' },
            amount, sender: account.address, recipient: account.address,
            cctp: { speed: source === 'arc' ? 'standard' : 'fast', forwarding: true, maxFee },
          })
          if (quote.kind !== 'evm-cctp') throw new Error('Unexpected quote kind')
          // Forwarding can charge the full maxFee. Bound it close to the live
          // quote (5% plus 0.001 USDC), within the scenario's absolute budget.
          const requiredFee = quote.protocolFeeAtomic + quote.forwardingFeeAtomic
          const tightFee = (requiredFee * 105n + 99n) / 100n + 1000n
          const approvedFee = tightFee < quote.maxFeeAtomic ? tightFee : quote.maxFeeAtomic
          const plan = { ...quote.plan, amountOut: formatUnits(quote.amountAtomic - approvedFee, 6), cctp: { ...quote.plan.cctp, maxFee: formatUnits(approvedFee, 6) } }
          console.table({ route: routeId, amount, maxFee: plan.cctp.maxFee, minimumDelivery: plan.amountOut })
          if (!mainnetExecutionEnabled()) return undefined
          state.destinationBalanceBefore = (await destinationReader.readContract({ address: token, abi: ABI, functionName: 'balanceOf', args: [account.address] })).toString()
          state.startedAt = Date.now()
          saveLiveState(path, state)
          await bridge.execute({ plan, confirmationTimeoutMs: 0, onCheckpoint: persist })
        }
        let progress = await recovery.recover({ checkpoint: state.checkpoint as BridgeCheckpoint })
        while (progress.next !== 'done') {
          if (progress.next === 'failed') throw new Error(progress.error)
          if (progress.next === 'resume') {
            if (!mainnetExecutionEnabled()) return undefined
            const resumed = await bridge.resume({ progress, confirmationTimeoutMs: 0, onCheckpoint: persist })
            progress = { next: 'wait', plan: progress.plan, receipt: resumed.receipt }
          } else if (progress.next !== 'wait') {
            throw new Error(`Forwarding requires attention: ${progress.next}; keep the checkpoint for recovery`)
          }
          progress = await recovery.wait({ progress, pollingIntervalMs: 5_000, timeoutMs: 20 * 60_000,
            onUpdate(update) {
              persist(createBridgeCheckpoint(update.plan, update.receipt))
            },
          })
        }
        // The SDK verifies the message nonce and destination mint. Also compare
        // the actual net mint against the recipient's balance increase.
        const message = progress.receipt.protocolState.message
        if (typeof message !== 'string' || !message.startsWith('0x')) throw new Error('Verified transfer is missing its attested message')
        const delivered = BigInt(slice(message as `0x${string}`, 216, 248)) - BigInt(slice(message as `0x${string}`, 312, 344))
        const balance = await destinationReader.readContract({ address: token, abi: ABI, functionName: 'balanceOf', args: [account.address] })
        expect(balance - BigInt(state.destinationBalanceBefore!)).toBe(delivered)
        expect(delivered).toBeGreaterThan(0n)
        persist(createBridgeCheckpoint(progress.plan, progress.receipt))
        state.deliveredAtomic = delivered.toString()
        state.deliveredAt = Date.now()
        state.completed = true
        saveLiveState(path, state)
        console.table({ route: routeId, sourceTxId: state.sourceTxId, destinationTxId: state.destinationTxId,
          received: formatUnits(delivered, 6), elapsedMs: state.deliveredAt - state.startedAt! })
        return formatUnits(delivered, 6)
      }
      const received = await leg('arc', destination, scenario.amount, scenario.maxFee)
      if (!received) return
      const returned = await leg(destination, 'arc', received, destination === 'ethereum' ? '0.1' : '0.03')
      if (!returned) return
      console.table({ roundtrip: caseName, sentFromArc: scenario.amount, returnedToArc: returned })
    }, 50 * 60_000)
  })
}
