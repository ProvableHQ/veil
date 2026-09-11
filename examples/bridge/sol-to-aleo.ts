import { getBase58Encoder } from '@solana/kit'
import { createPublicClient as createAleoPublicClient, http as aleoHttp } from '@provablehq/veil-core'
import {
  createAleoClient,
  createBridgeClient,
  createSolanaClient,
  DEFAULT_SOLANA_RPC_URL,
  solanaHttp,
  solanaKeyPair,
} from '@provablehq/aleo-bridge-sdk'

const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const EXECUTION_ENVIRONMENT_VARIABLE = 'EXECUTE_BRIDGE'
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 2 * 60_000
const AMOUNT = '0.000000001'

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function privateKeyBytes(raw: string): Uint8Array {
  // Solana tooling commonly exports either base58 text or a CLI JSON array.
  // Normalizing both formats here keeps the original secret in process memory
  // and rejects truncated material before a wallet account is constructed.
  let bytes: Uint8Array
  if (raw.startsWith('[')) {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error('SOLANA_PRIVATE_KEY JSON must contain exactly 64 byte values')
    }
    bytes = Uint8Array.from(parsed as number[])
  } else {
    bytes = Uint8Array.from(getBase58Encoder().encode(raw))
  }
  if (bytes.length !== 64) {
    throw new Error('SOLANA_PRIVATE_KEY must be a base58-encoded 64-byte keypair or a Solana CLI JSON byte array')
  }
  return bytes
}

function formatAmount(value: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals)
  const fraction = (value % unit).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${value / unit}.${fraction}` : (value / unit).toString()
}

/**
 * Moves native SOL from Solana to its wrapped representation on Aleo through
 * Hyperlane.
 *
 * The default run reads the sender's balance and current fees, prints them, and
 * exits without requesting a signature. With execution enabled, the Solana
 * keypair held by this process signs one source transaction. Hyperlane relays
 * its message and mints wrapped SOL to the Aleo recipient.
 *
 * @returns After read-only inspection or verified Aleo delivery, depending on
 * the execution acknowledgement.
 * @throws Error When configuration is missing, SOL is insufficient, the source
 * transaction fails, or Aleo delivery cannot be verified.
 *
 * @example
 * await runSolanaHyperlaneExample()
 */
export async function runSolanaHyperlaneExample(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || DEFAULT_SOLANA_RPC_URL
  const recipient = requiredEnvironmentVariable('ALEO_RECIPIENT')

  // ── Connect the source account and destination network ──────────────
  // Balance and fee inspection needs only a Solana RPC endpoint and sender
  // address. A private key adds the authority that signs the source transfer.
  // The Aleo client has no account because the Hyperlane relayer submits the
  // mint; it only verifies delivery in Aleo's canonical Mailbox.
  const privateKey = process.env.SOLANA_PRIVATE_KEY?.trim()
  const keypairBytes = privateKey ? privateKeyBytes(privateKey) : undefined
  const solana = createSolanaClient({
    transport: solanaHttp(rpcUrl),
    ...(keypairBytes ? { account: solanaKeyPair(keypairBytes) } : {}),
  })
  const senderAddress = solana.walletClient
    ? await solana.walletClient.getAddress()
    : requiredEnvironmentVariable('SOLANA_SENDER')
  const configuredSender = process.env.SOLANA_SENDER?.trim()
  if (solana.walletClient && configuredSender && configuredSender !== senderAddress) {
    // Quote and execution must name the same owner. Refusing a mismatch keeps
    // displayed balances and fees tied to the account that will actually sign.
    throw new Error(`SOLANA_SENDER does not match the private-key account ${senderAddress}`)
  }

  const bridge = createBridgeClient({
    environment: 'mainnet',
    clients: {
      solana,
      aleo: createAleoClient({
        publicClient: createAleoPublicClient({
          transport: aleoHttp(process.env.ALEO_RPC_URL?.trim() || 'https://api.provable.com/v2', { network: 'mainnet' }),
        }),
      }),
    },
  })

  // ── Describe the intended transfer ──────────────────────────────────
  // The caller supplies familiar chain and asset names, an amount, and the
  // recipient. The bridge catalog supplies the reviewed Solana programs,
  // required accounts, Aleo domain, decimal widths, and stages for this route.
  // No network is read and no wallet is asked to sign. The amount is one lamport.
  const plan = bridge.prepare({
    source: { chain: 'solana', asset: 'sol' },
    destination: { chain: 'aleo', asset: 'sol' },
    bridgeProtocol: 'hyperlane',
    amount: AMOUNT,
    recipient,
    sender: senderAddress,
  })

  // ── Check funds and current fees ────────────────────────────────────
  // The source account needs more than the transferred lamport. Current chain
  // reads price the Hyperlane delivery payment, Solana network fee, and rent
  // required by the route's temporary accounts. Their sum is the balance that
  // must be available. These reads do not request a signature or move SOL.
  const quote = await bridge.quote({ plan })
  if (quote.kind !== 'solana-hyperlane') throw new Error(`Unexpected quote kind: ${quote.kind}`)
  const balance = await solana.publicClient.getBalance(senderAddress)
  const decimals = plan.sourceAsset.decimals

  console.log('Read-only Solana SOL to Aleo SOL preflight')
  console.table({
    route: plan.route.id,
    sender: senderAddress,
    recipient,
    amount: `${formatAmount(quote.amountLamports, decimals)} SOL`,
    nativeBalance: `${formatAmount(balance, decimals)} SOL`,
    hyperlaneHookPayment: `${formatAmount(quote.igpPaymentLamports, decimals)} SOL`,
    solanaNetworkFee: `${formatAmount(quote.networkFeeLamports, decimals)} SOL`,
    totalRequired: `${formatAmount(quote.totalLamports, decimals)} SOL`,
    warpRouteProgram: plan.route.metadata?.warpProgramAddress ?? 'unknown',
    destinationDomain: plan.route.metadata?.destinationDomain ?? 'unknown',
  })

  // ── Stop before the fund-moving boundary by default ─────────────────
  // The read-only run can inspect any configured sender. Mainnet submission
  // additionally requires the matching private key and the exact acknowledgement.
  // This keeps copying the tutorial from creating an unexpected transfer.
  if (process.env[EXECUTION_ENVIRONMENT_VARIABLE] !== EXECUTION_ACKNOWLEDGEMENT) {
    console.log('\nPreflight complete; no SOL was transferred.')
    console.log(`Set ${EXECUTION_ENVIRONMENT_VARIABLE}=${EXECUTION_ACKNOWLEDGEMENT} to submit the transfer.`)
    return
  }
  if (!solana.walletClient) throw new Error('SOLANA_PRIVATE_KEY is required for execution')

  // One signed Solana transaction commits the SOL to the route, pays the
  // relayer, and creates the message for Aleo. That broadcast is the irreversible
  // source boundary; a timeout is not permission to submit the transfer again.
  console.log('\nExecution enabled. Submitting the transfer with the keypair held by this process.')
  const execution = await bridge.execute({
    plan,
    confirmationTimeoutMs: DEFAULT_CONFIRMATION_TIMEOUT_MS,
    onCheckpoint(checkpoint) {
      // The checkpoint records the public transfer intent and source signature
      // immediately after broadcast. A durable application atomically replaces
      // its saved checkpoint here; this tutorial only prints it.
      console.log('Optional recovery checkpoint:', JSON.stringify(checkpoint))
    },
  })
  if (execution.kind !== 'solana-hyperlane') throw new Error(`Unexpected execution kind: ${execution.kind}`)

  // ── Observe settlement without authorizing another transaction ──────
  // Chain reads first determine whether Solana accepted the signature, then
  // verify delivery in Aleo's canonical Mailbox. A timeout or RPC error leaves
  // the outcome unknown and does not undo a landed transfer. After a restart,
  // recover from the saved signature instead of signing another transaction.
  const progress = await bridge.wait({ progress: { next: 'wait', plan, receipt: execution.receipt } })
  if (progress.next === 'failed') throw new Error(progress.error)
  if (progress.next !== 'done') throw new Error(`Unexpected next operation: ${progress.next}`)
  console.log('Bridge completed:', progress.receipt)
}

runSolanaHyperlaneExample().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
