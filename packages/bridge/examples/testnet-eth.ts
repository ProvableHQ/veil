import { createHash, randomBytes } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { formatUnits, getAddress, zeroAddress } from 'viem'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import {
  createAleoClient, createBridgeClient, createBridgeCheckpoint, createEvmClient,
  deriveXReservePrivateMintAddressCommitment, evmHttp, evmPrivateKey, hyperlane,
  type BridgeCheckpoint, type BridgeProgress,
} from '@provablehq/aleo-bridge-sdk'
import { aleoExampleOptions } from './options.js'
import { TESTNET_ETH_REGISTRY } from './testnet-eth-registry.js'

const WARP = 'test_hyp_warp_token_eth_v2.aleo'
const FREEZELIST = 'shield_arc22_freezelist.aleo'
const EMPTY_ROOT = '3642222252059314292809609689035560016959342421640560347114299934615987159853field'
const ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_TESTNET_FUNDS'
type Action = 'mint' | 'claim' | 'withdraw' | 'recover' | 'resume'
type State = {
  version: 1
  registryVersion: string
  direction: 'mint' | 'withdraw'
  aleoAddress: string
  recipient: string
  amount: string
  secretNonce?: string
  commitmentHex?: string
  sourceAttempted?: boolean
  claimAttempted?: boolean
  checkpoint?: BridgeCheckpoint
}

/**
 * Configures a testnet ETH example invocation.
 * @property amount Gross ETH decimal amount, with at most 18 decimals; defaults to the saved amount or 0.001 ETH for a new transfer.
 * @property execute Enables signing and submission; defaults to the exact EXECUTE_BRIDGE testnet acknowledgement. Recovery always observes only.
 * @property statePath Local identity and checkpoint file; defaults to BRIDGE_STATE_FILE or .veil/testnet-eth-{mint,withdraw}.json. Reuse it after interruption.
 * @example const options: TestnetEthExampleOptions = { amount: '0.001', execute: false }
 */
export type TestnetEthExampleOptions = { amount?: string; execute?: boolean; statePath?: string }

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

/**
 * Runs a private Sepolia ETH mint, claim, withdrawal, or recovery through Veil.
 * Uses local keys, a pinned testnet-only registry, delegated proving by default,
 * and public Aleo execution fees. Quotes perform network reads and persist a
 * local mint identity; only explicitly enabled execution signs or moves funds.
 * @param action Selects mint-and-claim, claim-only, withdrawal, observation, or explicit prepared-transaction resumption.
 * @param options Overrides the saved/default amount, execution gate, or state file; defaults to environment configuration.
 * @returns After inspection, a caller authorization boundary, or verified completion.
 * @throws When deployment/state differs, a submission outcome is unknown, funding is missing, or proving, polling, or a transaction fails. Retain the state file after errors and timeouts.
 * @example await runTestnetEthExample('mint', { amount: '0.001', execute: false })
 */
export async function runTestnetEthExample(action: Action, options: TestnetEthExampleOptions = {}): Promise<void> {
  if (!['mint', 'claim', 'withdraw', 'recover', 'resume'].includes(action)) throw new Error('Use mint, claim, withdraw, recover, or resume')
  const execute = action !== 'recover' && (options.execute ?? process.env.EXECUTE_BRIDGE === ACKNOWLEDGEMENT)
  const statePath = resolve(options.statePath ?? process.env.BRIDGE_STATE_FILE ?? `.veil/testnet-eth-${action === 'withdraw' ? 'withdraw' : 'mint'}.json`)
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 })
  // An exclusive lock prevents concurrent CLI runs from spending the same identity.
  const lock = openSync(`${statePath}.lock`, 'wx', 0o600)
  try {
    let state: State | undefined = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : undefined
    if (!state && !['mint', 'withdraw'].includes(action)) throw new Error('No saved transfer. Run mint or withdraw first, or select BRIDGE_STATE_FILE')
    if (state && (state.version !== 1 || state.registryVersion !== TESTNET_ETH_REGISTRY.version)) throw new Error('State uses a different registry; retain its original reviewed registry for recovery')
    const direction = state?.direction ?? (action === 'withdraw' ? 'withdraw' : 'mint')
    if ((action === 'mint' || action === 'claim') && direction !== 'mint' || action === 'withdraw' && direction !== 'withdraw') throw new Error('State belongs to the other direction; select its original BRIDGE_STATE_FILE')
    const amount = options.amount ?? state?.amount ?? '0.001'
    if (state && amount !== state.amount) throw new Error('Amount differs from saved intent; use the original amount and state file')

    // Bind both RPCs to testnet before creating or authorizing a transfer.
    const sdk = await loadNetwork('testnet')
    const native = sdk.createAleoClient({
      privateKey: required('ALEO_PRIVATE_KEY'),
      networkUrl: process.env.ALEO_RPC_URL?.trim() || 'https://edge.provable.com/api/v2',
      ...aleoExampleOptions(), useFeeMaster: false, confirmationTimeout: 5 * 60_000,
    })
    const { account, publicClient, walletClient } = native
    const recipient = direction === 'mint' ? account.address
      : getAddress(process.env.SEPOLIA_RECIPIENT?.trim() || state?.recipient || required('SEPOLIA_RECIPIENT'))
    if (recipient === zeroAddress) throw new Error('Supply a nonzero Sepolia recipient')
    if (state && (state.aleoAddress !== account.address || state.recipient !== recipient)) throw new Error('Account or recipient differs from saved intent')
    const evmKey = action === 'mint' && execute && !state?.sourceAttempted ? required('EVM_PRIVATE_KEY') : undefined
    if (evmKey && !/^(0x)?[0-9a-fA-F]{64}$/.test(evmKey)) throw new Error('EVM_PRIVATE_KEY must contain 32 hexadecimal bytes')
    const sepolia = createEvmClient({
      transport: evmHttp(process.env.SEPOLIA_RPC_URL?.trim() || 'https://ethereum-sepolia-rpc.publicnode.com'),
      ...(evmKey ? { account: evmPrivateKey(`0x${evmKey.replace(/^0x/, '')}`) } : {}),
    })
    if (await sepolia.publicClient.getChainId() !== 11155111) throw new Error('SEPOLIA_RPC_URL must serve Sepolia (11155111)')
    const source = await publicClient.getProgram({ programId: WARP })
    const metadata = TESTNET_ETH_REGISTRY.routes[0]!.metadata!
    if (createHash('sha256').update(source).digest('hex') !== metadata.programSourceSha256) throw new Error('Testnet warp program changed; review its ABI and update the pinned example before submitting')
    const mailbox = await publicClient.readContract({ programId: 'test_hyp_mailbox.aleo', mapping: 'mailbox', key: 'true' })
    if (!mailbox || !/\blocal_domain:\s*1617853565u32\b/.test(mailbox)) throw new Error('Aleo RPC must serve the reviewed testnet mailbox')
    const bridge = createBridgeClient({
      environment: 'testnet', registry: TESTNET_ETH_REGISTRY,
      clients: { sepolia, 'aleo-testnet': createAleoClient({ publicClient, account: walletClient }) },
    })

    if (!state) {
      state = { version: 1, registryVersion: bridge.registry.version, direction, aleoAddress: account.address, recipient, amount }
      if (direction === 'mint') {
        // A random 248-bit scalar is below Aleo's scalar modulus. This local
        // identity is independent of the Shield wallet's encoding counter.
        state.secretNonce = `${BigInt(`0x${randomBytes(31).toString('hex')}`)}scalar`
        state.commitmentHex = await deriveXReservePrivateMintAddressCommitment(recipient, state.secretNonce, 'testnet')
      }
    }
    const saved = state
    const save = () => {
      const temporary = `${statePath}.tmp`
      const fd = openSync(temporary, 'wx', 0o600)
      try { writeFileSync(fd, JSON.stringify(saved, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temporary, statePath)
    }
    const persist = (checkpoint: BridgeCheckpoint) => { saved.checkpoint = checkpoint; save() }
    save()

    // This array mapping is directional; the generic boolean pause probes
    // cannot interpret it. A failed read stops this example before source funds move.
    const checkClaimPause = async () => {
      const pause = await publicClient.readContract({ programId: WARP, mapping: 'bridge_pause', key: 'true' })
      if (pause === null) return
      const flags = /^\[\s*(true|false)\s*,\s*(true|false)\s*\]$/.exec(pause)
      if (!flags || flags[1] === 'true') throw new Error('Inbound claims are paused or the pause state is invalid')
    }
    let progress: BridgeProgress
    if (saved.sourceAttempted) {
      if (!saved.checkpoint) throw new Error('Source submission outcome unknown; inspect chain/wallet history before any retry')
      // Recovery observes the existing transfer. It never repeats execute().
      progress = await bridge.recover({ checkpoint: saved.checkpoint })
    } else {
      if (action === 'claim' || action === 'recover' || action === 'resume') throw new Error('No source submission was attempted in this state file')
      if (direction === 'mint') await checkClaimPause()
      const priced = await bridge.quote({
        source: { chain: direction === 'mint' ? 'sepolia' : 'aleo-testnet', asset: 'eth' },
        destination: { chain: direction === 'mint' ? 'aleo-testnet' : 'sepolia', asset: 'eth' },
        amount, recipient, bridgeProtocol: 'hyperlane',
        ...(direction === 'mint'
          ? { mintMode: 'private', hyperlane: { addressEncoding: { commitmentHex: saved.commitmentHex! } } }
          : { sender: account.address }),
      })
      const plan = priced.plan
      const privateQuote = direction === 'withdraw'
        ? await hyperlane.aleo.quotePrivateTransfer(publicClient, { registry: bridge.registry, plan }) : undefined
      console.table({ route: plan.route.id, amountETH: amount, recipient,
        ...(priced.kind === 'evm-hyperlane' ? { sourceValueETH: formatUnits(priced.nativeValueAtomic, 18), bridgeFeeETH: formatUnits(priced.nativeFeeAtomic, 18) } : {}),
        ...(privateQuote ? { tokenFeeETH: formatUnits(privateQuote.protocolFeeAtomic, 18), netSepoliaETH: privateQuote.amountOut, dispatchMicrocredits: String(privateQuote.dispatchCreditsRecordMicrocredits) } : {}),
        executionFee: 'Separate; Aleo execution uses public credits', stateFile: statePath,
      })
      if (!execute) {
        console.log(`Quote only. Set EXECUTE_BRIDGE=${ACKNOWLEDGEMENT} to submit.`)
        return
      }
      if (direction === 'mint') {
        await checkClaimPause()
        // Persist the encoding before the irreversible Sepolia dispatch. Even
        // without a source hash, recovery can find a funded claimable entry.
        persist(createBridgeCheckpoint(plan, { id: saved.commitmentHex!, protocol: 'hyperlane', status: 'DELIVERY_PENDING', protocolState: { routeId: plan.route.id } }))
      }
      saved.sourceAttempted = true; save()
      const result = await bridge.execute({ plan, ...(privateQuote ? { hyperlanePrivateTransfer: { quote: privateQuote } } : {}), onCheckpoint: persist })
      progress = { next: 'wait', plan, receipt: result.receipt }
    }

    const wait = async (current: BridgeProgress) => bridge.wait({
      progress: current, timeoutMs: 20 * 60_000, pollingIntervalMs: 5_000,
      onUpdate(update) { persist(createBridgeCheckpoint(update.plan, update.receipt)) },
    })
    if (progress.next === 'wait') progress = await wait(progress)
    if (progress.next === 'resume') {
      if (action !== 'resume' || !execute) {
        console.log('Prepared source transaction requires explicit resume with the execution acknowledgement. Retain the state file.')
        return
      }
      if (direction !== 'withdraw' || !saved.checkpoint?.source?.preparedTransaction) throw new Error('No immutable prepared withdrawal is saved; inspect source history before any retry')
      const result = await bridge.resume({ progress, onCheckpoint: persist })
      progress = await wait({ next: 'wait', plan: progress.plan, receipt: result.receipt })
    }
    if (progress.next === 'complete') {
      if (!execute) { console.log('Private claim is funded. Run claim with the execution acknowledgement.'); return }
      const preparedClaim = progress.receipt.protocolState.preparedDestinationTransaction !== undefined
      if (saved.claimAttempted && !preparedClaim) throw new Error('Prior claim submission outcome unknown; inspect Aleo history before authorizing another claim')
      await checkClaimPause()
      let localClaim: { secretNonce: string; merkleProof: string } | undefined
      if (!preparedClaim) {
        if (!saved.secretNonce) throw new Error('The original local claim secret is missing; retain the state file')
        const root = await publicClient.readContract({ programId: FREEZELIST, mapping: 'freeze_list_root', key: '1u8' })
        if (!root) throw new Error('Missing freezelist root')
        const tree = root === EMPTY_ROOT ? [] : await publicClient.getComplianceFreezeList({ programId: FREEZELIST })
        // A fresh claim needs a current witness. A recovered claim rebroadcasts
        // its saved encrypted bytes without generating another secret or proof.
        const merkleProof = await sdk.generateFreezelistProof({ address: account.address, tree, root })
        localClaim = { secretNonce: saved.secretNonce, merkleProof }
      }
      saved.claimAttempted = true; save()
      const result = await bridge.complete({ progress, ...(localClaim ? { hyperlane: localClaim } : {}),
        onCheckpoint(checkpoint) { saved.claimAttempted = false; persist(checkpoint) },
      })
      progress = await wait({ next: 'wait', plan: progress.plan, receipt: result.receipt })
    }
    persist(createBridgeCheckpoint(progress.plan, progress.receipt))
    if (progress.next === 'failed') throw new Error(progress.error)
    console.log(progress.next === 'done' ? 'Transfer completed.' : `Transfer requires ${progress.next}; retain ${statePath}`)
  } finally {
    closeSync(lock); unlinkSync(`${statePath}.lock`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runTestnetEthExample(process.argv[2] as Action, { amount: process.argv[3] }).catch(error => {
    // Provider errors may contain transaction inputs; keep secrets out of logs.
    const message = error instanceof Error ? error.message : ''
    console.error(message && !/scalar|_nonce|private.?key|APrivateKey/i.test(message)
      ? message : 'Testnet bridge stopped; retain the state file and inspect submission history before retrying')
    process.exitCode = 1
  })
}
