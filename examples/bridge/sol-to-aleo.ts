import { getBase58Encoder } from '@solana/kit'
import {
  createBridgeClient,
  type SolanaRpcConfig,
} from '@provablehq/aleo-bridge-sdk'
import {
  createSolanaRpcReader,
  solanaExecutorFromKeyPair,
} from '@provablehq/aleo-bridge-sdk/solana'

const ROUTE_ID = 'hyperlane:solana/sol->aleo/sol'
const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const EXECUTION_ENVIRONMENT_VARIABLE = 'EXECUTE_HYPERLANE_SOL'
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 2 * 60_000

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

function millisecondsFromEnvironment(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return defaultValue
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1_000) {
    throw new Error(`${name} must be an integer greater than or equal to 1000`)
  }
  return value
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
 * endpoint and, when a private key is supplied, a local keypair executor from
 * `@provablehq/aleo-bridge-sdk/solana`. Route validation, fee quoting, and
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
  const rpc: SolanaRpcConfig = { url: process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com' }
  const recipient = requiredEnvironmentVariable('ALEO_RECIPIENT')
  const amount = requiredEnvironmentVariable('SOL_AMOUNT')

  const privateKey = process.env.SOLANA_PRIVATE_KEY?.trim()
  const executor = privateKey
    ? await solanaExecutorFromKeyPair({ secretKeyBytes: privateKeyBytes(privateKey), rpc })
    : undefined
  const senderAddress = executor ? await executor.getAddress() : requiredEnvironmentVariable('SOLANA_SENDER')
  const configuredSender = process.env.SOLANA_SENDER?.trim()
  if (executor && configuredSender && configuredSender !== senderAddress) {
    throw new Error(`SOLANA_SENDER does not match the private-key account ${senderAddress}`)
  }

  const bridge = createBridgeClient({
    environment: 'mainnet',
    solanaRpc: rpc,
    ...(executor ? { executors: { solana: executor } } : {}),
  })
  const plan = bridge.prepareTransfer({
    routeId: ROUTE_ID,
    amount,
    recipient,
    sender: senderAddress,
  })
  const quote = await bridge.quoteSolanaHyperlaneTransfer({ plan })
  const balance = await createSolanaRpcReader(rpc).getBalance(senderAddress)
  const decimals = plan.sourceAsset.decimals

  console.log('Read-only Solana SOL to Aleo SOL preflight')
  console.table({
    route: ROUTE_ID,
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
  if (!executor) throw new Error('SOLANA_PRIVATE_KEY is required for execution')

  console.log('\nExecution enabled. Submitting the transfer through the local keypair executor.')
  const execution = await bridge.executeSolanaHyperlaneTransfer({
    plan,
    confirmationTimeoutMs: millisecondsFromEnvironment('SOLANA_CONFIRMATION_TIMEOUT_MS', DEFAULT_CONFIRMATION_TIMEOUT_MS),
  })

  console.log('Transfer status:', execution.receipt.status)
  console.log('Submitted Solana transaction:', execution.receipt.sourceTxId)
  if (execution.receipt.status === 'SOURCE_CONFIRMING') {
    console.log('Confirmation timed out; the transaction was already broadcast and may still land.')
    console.log('Check the printed signature before resubmitting.')
    return
  }
  console.log('Solana dispatch confirmed.')
  console.log('Hyperlane message id:', execution.receipt.messageId ?? 'not found in the confirmed transaction logs')
  console.log('A Hyperlane relayer will deliver the message and mint SOL on Aleo.')
}

runSolanaHyperlaneExample().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
