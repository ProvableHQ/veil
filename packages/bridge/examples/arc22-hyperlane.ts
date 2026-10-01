import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getBase58Encoder } from '@solana/kit'
import { createPublicClient, http } from '@provablehq/veil-core'
import {
  createAleoClient, createBridgeClient, createBridgeCheckpoint, createEvmClient,
  createSolanaClient, DEFAULT_BRIDGE_REGISTRY, evmHttp, evmPrivateKey,
  solanaHttp, solanaKeyPair, type BridgeCheckpoint, type BridgeChainClient,
} from '@provablehq/aleo-bridge-sdk'
import { aleoExampleOptions } from './options.js'

/**
 * Lists the ten directed BAT, USDG, and ZEC routes exercised by this example.
 * @example const solanaDeposits = ARC22_ROUTES.filter(route => route.startsWith('hyperlane:solana/'))
 */
export const ARC22_ROUTES = [
  'hyperlane:ethereum/bat->aleo/bat', 'hyperlane:aleo/bat->ethereum/bat',
  'hyperlane:ethereum/usdg->aleo/usdg', 'hyperlane:aleo/usdg->ethereum/usdg',
  'hyperlane:solana/bat->aleo/bat', 'hyperlane:aleo/bat->solana/bat',
  'hyperlane:solana/usdg->aleo/usdg', 'hyperlane:aleo/usdg->solana/usdg',
  'hyperlane:solana/zec->aleo/zec', 'hyperlane:aleo/zec->solana/zec',
] as const

/**
 * Configures one live route demonstration.
 * @property routeId One of ARC22_ROUTES; no implicit route or amount selection.
 * @property amount Decimal token amount representable on both chains (BAT uses 18 decimals on Aleo/Ethereum and 8 on Solana).
 * @property sender Source address whose account must match when execution is enabled.
 * @property recipient Destination address receiving the public token balance.
 * @property execute Enables signing and submission; defaults to false.
 * @property statePath Durable checkpoint file required for execution; reuse after interruptions.
 * @example
 * const options: Arc22ExampleOptions = {
 *   routeId: 'hyperlane:solana/zec->aleo/zec', amount: '0.0001',
 *   sender: process.env.BRIDGE_ARC22_SENDER!, recipient: process.env.BRIDGE_ARC22_RECIPIENT!,
 * }
 */
export type Arc22ExampleOptions = {
  routeId: string; amount: string; sender: string; recipient: string
  execute?: boolean; statePath?: string
}

type State = { intent: string; attempted?: boolean; checkpoint?: BridgeCheckpoint }
function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

/**
 * Quotes or executes one ARC-22 Hyperlane route against deployed mainnet contracts.
 * Reads live fees without keys by default. Execution saves checkpoints, then uses
 * a fresh public-only client to recover and verify delivery. Aleo sources spend
 * public balances; unshield private records separately before running this example.
 * @param options Explicit route, amount, addresses, execution choice, and state file.
 * @returns The live quote or verified completed progress; a timeout throws and retains recovery state.
 * @throws When configuration is invalid, a signer differs, a prior submission is uncertain, or delivery fails.
 * @example
 * await runArc22Example({ routeId: 'hyperlane:solana/zec->aleo/zec', amount: '0.0001', sender: process.env.BRIDGE_ARC22_SENDER!, recipient: process.env.BRIDGE_ARC22_RECIPIENT! })
 */
export async function runArc22Example(options: Arc22ExampleOptions) {
  if (!ARC22_ROUTES.some(id => id === options.routeId)) throw new Error('Unsupported ARC-22 example route')
  const route = DEFAULT_BRIDGE_REGISTRY.routes.find(entry => entry.id === options.routeId)!
  const source = DEFAULT_BRIDGE_REGISTRY.assets.find(entry => entry.id === route.sourceAssetId)!
  const destination = DEFAULT_BRIDGE_REGISTRY.assets.find(entry => entry.id === route.destinationAssetId)!
  const execute = options.execute === true
  if (execute && !options.statePath) throw new Error('Execution requires a durable statePath')
  const aleoPublic = createPublicClient({ transport: http(process.env.ALEO_RPC_URL || 'https://edge.provable.com/api/v2', { network: 'mainnet' }) })
  const clients: Record<string, BridgeChainClient> = { aleo: createAleoClient({ publicClient: aleoPublic }) }
  if ([source.chainId, destination.chainId].includes('ethereum')) {
    clients.ethereum = createEvmClient({ transport: evmHttp(process.env.BRIDGE_LIVE_ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com') })
  }
  if ([source.chainId, destination.chainId].includes('solana')) {
    clients.solana = createSolanaClient({ transport: solanaHttp(process.env.BRIDGE_LIVE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com') })
  }
  const recovery = createBridgeClient({ environment: 'mainnet', clients: { ...clients } })
  const intent = { source: { chain: source.chainId, asset: source.key }, destination: { chain: destination.chainId, asset: destination.key },
    bridgeProtocol: 'hyperlane' as const, amount: options.amount, sender: options.sender, recipient: options.recipient }
  if (execute) {
    if (source.chainId === 'ethereum') {
      const key = required('BRIDGE_EVM_PRIVATE_KEY').replace(/^0x/i, '')
      if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('Invalid EVM private key format')
      clients.ethereum = createEvmClient({ transport: evmHttp(process.env.BRIDGE_LIVE_ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com'), account: evmPrivateKey(`0x${key}`) })
    } else if (source.chainId === 'solana') {
      const raw = required('BRIDGE_SOLANA_PRIVATE_KEY')
      const parsed: unknown = raw.startsWith('[') ? JSON.parse(raw) : [...getBase58Encoder().encode(raw)]
      if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Solana keypair must contain 64 bytes')
      clients.solana = createSolanaClient({ transport: solanaHttp(process.env.BRIDGE_LIVE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'), account: solanaKeyPair(Uint8Array.from(parsed)) })
    } else {
      const { loadNetwork } = await import('@provablehq/veil-aleo-sdk')
      const sdk = await loadNetwork('mainnet')
      const aleo = sdk.createAleoClient({ privateKey: required('BRIDGE_PRIVATE_KEY'), networkUrl: process.env.ALEO_RPC_URL || 'https://edge.provable.com/api/v2', ...aleoExampleOptions(), useFeeMaster: false })
      if (String(aleo.account.address) !== options.sender) throw new Error('Aleo signer does not match sender')
      clients.aleo = createAleoClient({ publicClient: aleo.publicClient, account: aleo.walletClient })
    }
    const sourceClient = clients[source.chainId]!
    if (sourceClient.family !== 'aleo') {
      const actual = await sourceClient.walletClient!.getAddress()
      const matches = sourceClient.family === 'evm' ? actual.toLowerCase() === options.sender.toLowerCase() : actual === options.sender
      if (!matches) throw new Error('Source signer does not match sender')
    }
  }
  const bridge = createBridgeClient({ environment: 'mainnet', clients })
  const path = options.statePath ? resolve(options.statePath) : undefined
  let lock: number | undefined
  try {
    if (path) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      lock = openSync(`${path}.lock`, 'wx', 0o600)
    }
    const fingerprint = JSON.stringify(intent)
    const state: State = path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { intent: fingerprint }
    if (state.intent !== fingerprint) throw new Error('Saved intent differs; reuse its original route, amount, sender, and recipient')
    const save = () => {
      if (!path) throw new Error('Missing state path')
      writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 })
      renameSync(`${path}.tmp`, path)
    }
    const persist = (checkpoint: BridgeCheckpoint) => { state.checkpoint = checkpoint; save() }
    if (state.attempted && !state.checkpoint) throw new Error('Prior submission has an unknown outcome; inspect the source chain before taking further action')
    let progress
    if (state.checkpoint) {
      progress = await recovery.recover({ checkpoint: state.checkpoint })
    } else {
      const quote = await bridge.quote(intent)
      console.log(JSON.stringify(quote, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2))
      if (!execute) return quote
      state.attempted = true
      save()
      await bridge.execute({ plan: quote.plan, mode: 'signer', onCheckpoint: persist })
      if (!state.checkpoint) throw new Error('Submission returned without a checkpoint; inspect chain state')
      progress = await recovery.recover({ checkpoint: state.checkpoint })
    }
    if (progress.next === 'wait') progress = await recovery.wait({ progress, onUpdate: next => persist(createBridgeCheckpoint(next.plan, next.receipt)) })
    if (progress.next === 'resume' && execute) {
      const execution = await bridge.resume({ progress, onCheckpoint: persist })
      progress = await recovery.wait({ progress: { next: 'wait', plan: progress.plan, receipt: execution.receipt }, onUpdate: next => persist(createBridgeCheckpoint(next.plan, next.receipt)) })
    }
    if (progress.next !== 'done') throw new Error(`Bridge not delivered: ${progress.next}; keep the checkpoint and recover`)
    persist(createBridgeCheckpoint(progress.plan, progress.receipt))
    console.log('Verified destination delivery:', progress.receipt)
    return progress
  } finally {
    if (lock !== undefined) { closeSync(lock); unlinkSync(`${path}.lock`) }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runArc22Example({ routeId: required('BRIDGE_ARC22_ROUTE_ID'), amount: required('BRIDGE_ARC22_AMOUNT'),
    sender: required('BRIDGE_ARC22_SENDER'), recipient: required('BRIDGE_ARC22_RECIPIENT'),
    statePath: process.env.BRIDGE_ARC22_STATE_PATH,
    execute: process.env.EXECUTE_BRIDGE === 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS',
  }).catch(error => { console.error(error); process.exitCode = 1 })
}
