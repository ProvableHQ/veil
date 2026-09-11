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
 * Quotes or submits the reviewed mainnet Solana SOL-to-Aleo SOL Warp Route.
 *
 * The example builds a bridge client with an injected Solana JSON-RPC
 * endpoint and, when a private key is supplied, a local keypair account.
 * Route validation, fee quoting, and
 * transaction assembly all run inside the bridge client; the script only
 * reads environment input and prints the result. It remains read-only unless
 * the execution acknowledgement is set.
 *
 * @returns A promise that resolves after preflight or after the submitted
 * transaction is confirmed or times out.
 * @throws Error When input, quoting, or execution fails.
 *
 * @example
 * await runSolanaHyperlaneExample()
 */
export async function runSolanaHyperlaneExample(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || DEFAULT_SOLANA_RPC_URL
  const recipient = requiredEnvironmentVariable('ALEO_RECIPIENT')

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
  const plan = bridge.prepare({
    source: { chain: 'solana', asset: 'sol' },
    destination: { chain: 'aleo', asset: 'sol' },
    bridgeProtocol: 'hyperlane',
    amount: AMOUNT,
    recipient,
    sender: senderAddress,
  })
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

  if (process.env[EXECUTION_ENVIRONMENT_VARIABLE] !== EXECUTION_ACKNOWLEDGEMENT) {
    console.log('\nPreflight complete; no SOL was transferred.')
    console.log(`Set ${EXECUTION_ENVIRONMENT_VARIABLE}=${EXECUTION_ACKNOWLEDGEMENT} to submit the transfer.`)
    return
  }
  if (!solana.walletClient) throw new Error('SOLANA_PRIVATE_KEY is required for execution')

  console.log('\nExecution enabled. Submitting the transfer through the local keypair account.')
  const execution = await bridge.execute({
    plan,
    confirmationTimeoutMs: DEFAULT_CONFIRMATION_TIMEOUT_MS,
    onCheckpoint(checkpoint) {
      console.log('Optional recovery checkpoint:', JSON.stringify(checkpoint))
    },
  })
  if (execution.kind !== 'solana-hyperlane') throw new Error(`Unexpected execution kind: ${execution.kind}`)
  const progress = await bridge.wait({ progress: { next: 'wait', plan, receipt: execution.receipt } })
  if (progress.next === 'failed') throw new Error(progress.error)
  if (progress.next !== 'done') throw new Error(`Unexpected next operation: ${progress.next}`)
  console.log('Bridge completed:', progress.receipt)
}

runSolanaHyperlaneExample().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
