/**
 * Runs or recovers a mainnet Solana-to-Aleo Hyperlane deposit.
 *
 * The script delegates route selection, quoting, transaction construction,
 * confirmation, message extraction, and destination verification to the
 * bridge client. Its only persistence responsibility is storing the compact
 * checkpoint emitted at the submission boundary.
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import bs58 from 'bs58'
import { createPublicClient as createAleoPublicClient, http as aleoHttp } from '@provablehq/veil-core'
import {
  createAleoClient,
  createBridgeClient,
  createSolanaClient,
  DEFAULT_SOLANA_RPC_URL,
  solanaHttp,
  solanaKeyPair,
  type BridgeCheckpoint,
  type BridgeProgress,
} from '../src/index.js'

const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const ENV_FILE = join(SCRIPT_DIRECTORY, '.env.solana-deposit')
const STATE_FILE = join(SCRIPT_DIRECTORY, '.solana-deposit.state.json')

function loadEnvironment(): void {
  if (!existsSync(ENV_FILE)) return
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (!match || process.env[match[1]!]) continue
    process.env[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2')
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function decodeSecretKey(raw: string): Uint8Array {
  const bytes = raw.startsWith('[')
    ? Uint8Array.from(JSON.parse(raw) as number[])
    : bs58.decode(raw)
  if (bytes.length !== 64) {
    throw new Error('SOLANA_DEPOSIT_SECRET_KEY must encode a 64-byte Solana keypair')
  }
  return bytes
}

function loadCheckpoint(): BridgeCheckpoint | undefined {
  if (!existsSync(STATE_FILE)) return undefined
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as BridgeCheckpoint
}

function saveCheckpoint(checkpoint: BridgeCheckpoint): void {
  const temporary = `${STATE_FILE}.tmp`
  writeFileSync(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, STATE_FILE)
}

async function main(): Promise<void> {
  loadEnvironment()
  if (process.argv.includes('--reset')) rmSync(STATE_FILE, { force: true })

  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || DEFAULT_SOLANA_RPC_URL
  const solana = createSolanaClient({
    transport: solanaHttp(rpcUrl),
    account: solanaKeyPair(decodeSecretKey(required('SOLANA_DEPOSIT_SECRET_KEY'))),
  })
  const aleo = createAleoClient({
    publicClient: createAleoPublicClient({
      transport: aleoHttp(process.env.ALEO_RPC_URL?.trim() || 'https://api.provable.com/v2', { network: 'mainnet' }),
    }),
  })
  const bridge = createBridgeClient({ environment: 'mainnet', clients: { solana, aleo } })
  const checkpoint = loadCheckpoint()
  let progress: BridgeProgress

  if (checkpoint) {
    progress = await bridge.recover({ checkpoint })
    console.log('Recovered checkpoint:', checkpoint.source?.transactionId)
  } else {
    const sender = await solana.walletClient!.getAddress()
    const plan = bridge.prepare({
      source: { chain: 'solana', asset: 'sol' },
      destination: { chain: 'aleo', asset: 'sol' },
      bridgeProtocol: 'hyperlane',
      amount: process.env.DEPOSIT_SOL?.trim() || '0.002',
      recipient: required('ALEO_RECIPIENT'),
      sender,
    })
    const quote = await bridge.quote({ plan })
    if (quote.kind !== 'solana-hyperlane') throw new Error(`Unexpected quote kind: ${quote.kind}`)
    const balance = await solana.publicClient.getBalance(sender)
    console.table({
      route: plan.route.id,
      sender,
      recipient: plan.recipient,
      amountLamports: quote.amountLamports.toString(),
      balanceLamports: balance.toString(),
      gasAndRentLamports: (quote.totalLamports - quote.amountLamports).toString(),
      totalLamports: quote.totalLamports.toString(),
    })
    if (process.env.EXECUTE_SOLANA_DEPOSIT !== EXECUTION_ACKNOWLEDGEMENT) {
      console.log(`Set EXECUTE_SOLANA_DEPOSIT=${EXECUTION_ACKNOWLEDGEMENT} to submit.`)
      return
    }
    const execution = await bridge.execute({ plan, onCheckpoint: saveCheckpoint })
    progress = { next: 'wait', plan, receipt: execution.receipt }
  }

  if (progress.next === 'wait') progress = await bridge.wait({ progress })
  if (progress.next === 'failed') throw new Error(progress.error)
  if (progress.next !== 'done') throw new Error(`Unexpected next operation: ${progress.next}`)
  console.log('Bridge completed:', progress.receipt)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
