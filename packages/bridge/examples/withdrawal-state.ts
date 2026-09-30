import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createPublicClient, http, parseAbi, formatUnits, getAbiItem, type Hex } from 'viem'
import type { BridgeCheckpoint } from '@provablehq/aleo-bridge-sdk'
import { withdrawalAmount, GATEWAY_MINTER, WITHDRAWAL_EVENTS, type WithdrawalExpectation } from './withdrawal-delivery.js'

type State = { intent: string; startBlock: string; before: string; attempted?: boolean; checkpoint?: BridgeCheckpoint; delivered?: { hash: Hex; amount: string } }
/**
 * Opens an exclusive, durable Ethereum withdrawal observation session.
 * @param path Caller-owned state file; reuse the same file after interruption.
 * @param intent Stable serialized route, sender, recipient, amount, and burn mode.
 * @param rpc Ethereum mainnet RPC URL used for receipt and balance verification.
 * @param expected Deployment and quote bounds used to reject unrelated transfers.
 * @returns Checkpoint storage, a read-only delivery observer, and a lock release function.
 * @throws When configuration changes, another process holds the lock, or prior submission is uncertain.
 * @example const tracker = await openWithdrawalState(path, intent, rpc, expected)
 */
export async function openWithdrawalState(path: string, intent: string, rpc: string, expected: WithdrawalExpectation) {
  const client = createPublicClient({ transport: http(rpc) })
  if (await client.getChainId() !== 1) throw new Error('Withdrawal observer requires Ethereum mainnet')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const lock = openSync(path + '.lock', 'wx', 0o600)
  const release = () => { closeSync(lock); unlinkSync(path + '.lock') }
  try {
    const balance = () => client.readContract({ address: expected.token, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [expected.recipient] })
    const state: State = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {
      intent, startBlock: String(await client.getBlockNumber()), before: String(await balance()),
    }
    if (state.intent !== intent || !/^\d+$/.test(state.startBlock) || !/^\d+$/.test(state.before)) throw new Error('Withdrawal state differs or is malformed; reuse the original configuration')
    if (state.attempted && !state.checkpoint) throw new Error('Submission outcome unknown. Inspect chain history; do not repeat the burn')
    const save = () => { writeFileSync(path + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 }); renameSync(path + '.tmp', path) }
    return {
      checkpoint: state.checkpoint,
      delivered: state.delivered,
      begin() { state.attempted = true; save() },
      persist(checkpoint: BridgeCheckpoint) { state.checkpoint = checkpoint; save() },
      release,
      async wait(timeoutMs = 30 * 60_000) {
        if (state.delivered) return state.delivered
        const deadline = Date.now() + timeoutMs
        let cursor = BigInt(state.startBlock)
        let candidate: { hash: Hex; amount: bigint } | undefined
        while (Date.now() < deadline) {
          // Scan at most 1,000 blocks per call, leaving one confirmation behind the head.
          const head = await client.getBlockNumber({ cacheTime: 0 })
          const confirmed = head > 0n ? head - 1n : 0n
          for (let batches = 0; cursor <= confirmed && batches < 10; batches++) {
            const end = cursor + 999n < confirmed ? cursor + 999n : confirmed
            const eventBatches = await Promise.all([
              client.getLogs({ address: expected.reserve, event: getAbiItem({ abi: WITHDRAWAL_EVENTS, name: 'Withdrawn' }), args: { localRecipient: expected.recipient }, fromBlock: cursor, toBlock: end }),
              client.getLogs({ address: GATEWAY_MINTER, event: getAbiItem({ abi: WITHDRAWAL_EVENTS, name: 'AttestationUsed' }), args: { recipient: expected.recipient }, fromBlock: cursor, toBlock: end }),
            ])
            const logs = eventBatches.flat()
            for (const hash of new Set(logs.map(log => log.transactionHash))) {
              const receipt = await client.getTransactionReceipt({ hash })
              if (receipt.status !== 'success' || receipt.blockNumber > confirmed) continue
              const amount = withdrawalAmount(receipt.logs, expected)
              if (amount === undefined) continue
              if (candidate && candidate.hash !== hash) throw new Error('Multiple matching withdrawals; inspect delivery manually and retain the checkpoint')
              candidate = { hash, amount }
            }
            cursor = end + 1n
          }
          if (candidate && cursor > confirmed) {
            if (await balance() - BigInt(state.before) !== candidate.amount) throw new Error('Destination balance does not match the withdrawal; keep the recipient idle and inspect manually')
            state.delivered = { hash: candidate.hash, amount: String(candidate.amount) }; save()
            console.log('Observed Ethereum USDC delivery:', candidate.hash, formatUnits(candidate.amount, 6), 'USDC')
            return state.delivered
          }
          await new Promise(resolve => setTimeout(resolve, 5_000))
        }
        throw new Error('Ethereum delivery timeout. Keep the state file and rerun to observe the existing burn')
      },
    }
  } catch (error) { release(); throw error }
}
