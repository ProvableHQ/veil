/**
 * Previews or runs public ALEO → BSC → Aleo through Verulink.
 * Uses a durable checkpoint and a submission-attempt marker for each wallet
 * boundary. The default is read-only; execution requires EXECUTE_BRIDGE.
 */
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createPublicClient, http, readContract } from '@provablehq/veil-core'
import { formatUnits, getAddress, type Hex } from 'viem'
import { createAleoClient, createBridgeCheckpoint, createBridgeClient, createEvmClient, evmHttp, evmPrivateKey,
  type BridgeCheckpoint } from '@provablehq/aleo-bridge-sdk'
import { aleoExampleOptions } from './options.js'

type Leg = { amount: string; sourceAttempted?: boolean; claimAttempted?: boolean; checkpoint?: BridgeCheckpoint; received?: string }
type State = { version: 1; aleo: string; bsc: string; amount: string; legs: Leg[] }
const ACK = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const BNB_RESERVE = 1000000000000000n // 0.001 BNB for claim, approval, burn, and gas-price variation.

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

/**
 * Runs a checkpointed two-leg mainnet journey or previews its current quotes.
 * Reads ALEO_ADDRESS, BSC_ADDRESS, optional AMOUNT (default 20 ALEO), and
 * ROUNDTRIP_STATE_FILE (default ~/.local/state/veil/examples/verulink.json).
 * Execution requires ALEO_PRIVATE_KEY, EVM_PRIVATE_KEY, and EXECUTE_BRIDGE.
 * Keys stay in memory; checkpoints contain public transaction data only.
 * @returns Resolves after preview or verified delivery of both legs.
 * @throws When gas, balances, signing identities, recovery evidence, or delivery are insufficient.
 * @example await runVerulinkRoundtrip()
 */
export async function runVerulinkRoundtrip(): Promise<void> {
  const aleo = required('ALEO_ADDRESS'), bsc = getAddress(required('BSC_ADDRESS'))
  const amount = process.env.AMOUNT?.trim() || '20'
  const execute = process.env.EXECUTE_BRIDGE === ACK
  const aleoRpc = process.env.ALEO_RPC_URL?.trim() || 'https://api.explorer.provable.com/v1'
  const bscRpc = process.env.BSC_RPC_URL?.trim() || 'https://bsc-dataseed.bnbchain.org'
  const clients = {
    aleo: createAleoClient({ publicClient: createPublicClient({ transport: http(aleoRpc, { network: 'mainnet' }) }) }),
    bsc: createEvmClient({ transport: evmHttp(bscRpc) }),
  }
  const bridge = createBridgeClient({ clients })
  if (clients.bsc!.family !== 'evm' || clients.aleo!.family !== 'aleo') throw new Error('Unexpected client family')
  const [bnb, publicAleo] = await Promise.all([
    clients.bsc!.publicClient.getBalance(bsc),
    readContract(clients.aleo!.publicClient, { programId: 'credits.aleo', mapping: 'account', key: aleo }),
  ])
  console.log(JSON.stringify({ amount, bnb: formatUnits(bnb, 18), publicAleoMicrocredits: publicAleo, execute }))
  if (!execute) {
    const outbound = await bridge.quote({ source: { chain: 'aleo', asset: 'aleo' }, destination: { chain: 'bsc', asset: 'aleo' },
      amount, sender: aleo, recipient: bsc })
    const inbound = await bridge.quote({ source: { chain: 'bsc', asset: 'aleo' }, destination: { chain: 'aleo', asset: 'aleo' },
      amount: outbound.plan.amountOut!, sender: bsc, recipient: aleo })
    console.log(JSON.stringify({ bscReceivedEstimate: outbound.plan.amountOut, aleoReturnedEstimate: inbound.plan.amountOut }))
    return
  }

  const path = resolve(process.env.ROUNDTRIP_STATE_FILE?.trim() || homedir() + '/.local/state/veil/examples/verulink.json')
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const lock = await open(path + '.lock', 'wx', 0o600)
  await lock.writeFile(String(process.pid))
  try {
    let state: State
    try { state = JSON.parse(await readFile(path, 'utf8')) as State }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      state = { version: 1, aleo, bsc, amount, legs: [{ amount }] }
    }
    if (state.version !== 1 || state.aleo !== aleo || state.bsc !== bsc || state.amount !== amount || !Array.isArray(state.legs)) {
      throw new Error('Saved journey differs from the configured accounts or amount')
    }
    if (!state.legs[0]?.sourceAttempted && bnb < BNB_RESERVE) throw new Error('Fund the BSC account with at least 0.001 BNB before committing ALEO')
    const save = async () => {
      await writeFile(path + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 })
      await rename(path + '.tmp', path)
    }
    const network = await (await import('@provablehq/veil-aleo-sdk')).loadNetwork('mainnet')
    const signer = network.createAleoClient({ privateKey: required('ALEO_PRIVATE_KEY'), networkUrl: aleoRpc, ...aleoExampleOptions() })
    if (signer.walletClient.account?.address !== aleo) throw new Error('Aleo signer differs from ALEO_ADDRESS')
    clients.aleo = createAleoClient({ publicClient: signer.publicClient, account: signer.walletClient })
    clients.bsc = createEvmClient({ transport: evmHttp(bscRpc), account: evmPrivateKey(required('EVM_PRIVATE_KEY') as Hex) })
    if (getAddress(await clients.bsc.walletClient!.getAddress()) !== bsc) throw new Error('BSC signer differs from BSC_ADDRESS')
    const writable = createBridgeClient({ clients })
    for (let index = 0; index < 2; index++) {
      const leg = state.legs[index] ?? (state.legs[index] = { amount: formatUnits(BigInt(state.legs[0]!.received!), 6) })
      if (leg.received) continue
      const onCheckpoint = async (checkpoint: BridgeCheckpoint) => { leg.checkpoint = checkpoint; await save() }
      if (!leg.checkpoint) {
        if (leg.sourceAttempted) throw new Error('Source submission is uncertain; recover its transaction hash before continuing')
        const quoted = await writable.quote({ source: { chain: index === 0 ? 'aleo' : 'bsc', asset: 'aleo' },
          destination: { chain: index === 0 ? 'bsc' : 'aleo', asset: 'aleo' }, amount: leg.amount,
          sender: index === 0 ? aleo : bsc, recipient: index === 0 ? bsc : aleo })
        if (index === 0) {
          // Verify the estimated return clears its fees and minimum before committing ALEO.
          await writable.quote({ source: { chain: 'bsc', asset: 'aleo' }, destination: { chain: 'aleo', asset: 'aleo' },
            amount: quoted.plan.amountOut!, sender: bsc, recipient: aleo })
        }
        leg.sourceAttempted = true
        await save()
        await writable.execute({ plan: quoted.plan, onCheckpoint })
      }
      if (!leg.checkpoint) throw new Error('Wallet returned without a source checkpoint; reconcile before retrying')
      let progress = await writable.recover({ checkpoint: leg.checkpoint })
      const deadline = Date.now() + 20 * 60_000
      for (;;) {
        console.log(JSON.stringify({ leg: index + 1, status: progress.receipt.status, sourceTxId: progress.receipt.sourceTxId,
          destinationTxId: progress.receipt.destinationTxId }))
        if (progress.next === 'done') {
          const net = (progress.receipt.protocolState.packet as { amount?: unknown } | undefined)?.amount
          if (typeof net !== 'string' || !/^\d+$/.test(net)) throw new Error('Completed transfer has no verified packet amount')
          leg.received = net
          await save()
          break
        }
        if (progress.next === 'failed') throw new Error(progress.error)
        if (Date.now() >= deadline) throw new Error('Bridge polling timed out; keep the checkpoint and recover')
        if (progress.next === 'resume') {
          if (!leg.checkpoint.source?.preparedTransaction) throw new Error('Approval-only BSC recovery requires wallet reconciliation')
          await writable.resume({ progress, onCheckpoint })
        } else if (progress.next === 'complete') {
          if (leg.claimAttempted && !leg.checkpoint.destination?.preparedTransaction) {
            throw new Error('Claim submission is uncertain; add its destination transaction hash before continuing')
          }
          leg.claimAttempted = true
          await save()
          await writable.complete({ progress, onCheckpoint })
        } else {
          progress = await writable.wait({ progress, timeoutMs: Math.max(0, deadline - Date.now()), pollingIntervalMs: 15000,
            onUpdate: async update => onCheckpoint(createBridgeCheckpoint(update.plan, update.receipt)) })
          continue
        }
        progress = await writable.recover({ checkpoint: leg.checkpoint })
      }
    }
    console.log(JSON.stringify({ completed: true, aleoReturned: formatUnits(BigInt(state.legs[1]!.received!), 6), stateFile: path }))
  } finally {
    await lock.close()
    await unlink(path + '.lock')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runVerulinkRoundtrip().catch(error => {
    console.error(error instanceof Error ? error.message : 'Verulink round trip stopped')
    process.exitCode = 1
  })
}
