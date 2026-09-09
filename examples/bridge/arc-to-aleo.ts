/**
 * Quotes or submits a mainnet Arc USDC to Aleo USDCx xReserve mint.
 *
 * Run without EXECUTE_XRESERVE_DEPOSIT for a read-only preflight. Live
 * execution simulates every transaction and requires an explicit
 * acknowledgement before the local signer broadcasts it. Pass `--verbose`
 * to print contract, quote, simulation, and polling diagnostics.
 */

import {
  TransactionReceiptNotFoundError,
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  isAddress,
  isHash,
  isHex,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { pathToFileURL } from 'node:url'
import {
  buildXReserveHookData,
  createBridgeClient,
  type AleoBridgeExecutor,
  type AleoMintMode,
  type BridgeTransferPlan,
  type BridgeTransferReceipt,
  type EvmBridgeExecutor,
  type XReserveAttestationResult,
} from '@provablehq/aleo-bridge-sdk'

const ROUTE_ID = 'xreserve:arc/usdc->aleo/usdcx'
const ARC_CHAIN_ID = 5042
const ARC_SOURCE_DOMAIN = 26
const ALEO_REMOTE_DOMAIN = 10002
const XRESERVE_CONTRACT = getAddress('0x8888888199b2Df864bf678259607d6D5EBb4e3Ce')
const USDC_CONTRACT = getAddress('0x3600000000000000000000000000000000000000')
const DEPOSIT_SIGNATURE = 'depositToRemote(uint256,uint32,bytes32,address,uint256,bytes)'
const DEPOSIT_SELECTOR = toFunctionSelector(DEPOSIT_SIGNATURE)
const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const PRIVATE_MINT_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_SUBMITS_AN_ALEO_PRIVATE_MINT'
const DEFAULT_ATTESTATION_POLL_INTERVAL_MS = 10_000
const DEFAULT_ATTESTATION_TIMEOUT_MS = 30 * 60_000
const DEFAULT_MINT_POLL_INTERVAL_MS = 10_000
const DEFAULT_MINT_TIMEOUT_MS = 30 * 60_000
const DEFAULT_ALEO_TRANSACTION_POLL_INTERVAL_MS = 5_000
const DEFAULT_ALEO_TRANSACTION_TIMEOUT_MS = 5 * 60_000
const DEFAULT_ALEO_EXECUTION_CONFIRMATION_TIMEOUT_MS = 5 * 60_000
const ALEO_PROVING_PROGRESS_INTERVAL_MS = 15_000
const ARC_EXPLORER_TRANSACTION_URL = 'https://arc-scan.org/tx'
const ALEO_EXPLORER_TRANSACTION_URL = 'https://explorer.provable.com/transaction'
const VERBOSE = process.argv.slice(2).includes('--verbose')

const XRESERVE_READ_ABI = parseAbi([
  'function domain() view returns (uint32)',
  'function getRemoteDomainDepositor(uint32 remoteDomain) view returns (address)',
])

type ArcMintHistoryEntry = {
  attestationMessageHash?: string
  aleoAddress?: string
  aleo?: { status?: string, aleoMintTxId?: string }
  mintExecution?: { executionType?: string }
}

type CompletedXReserveAttestation = Extract<XReserveAttestationResult, { status: 'complete' }>
type AleoTransactionStatus = 'accepted' | 'rejected' | 'pending' | 'not_found'
type PrivateMintContext = {
  executor: AleoBridgeExecutor
  transactionStatus: (params: { transactionId: string }) => Promise<{
    status: AleoTransactionStatus
    transactionId: string
  }>
}

function verboseLog(...values: unknown[]): void {
  if (VERBOSE) console.log(...values)
}

function printTransferSummary(sender: string, recipient: string, amount: string): void {
  console.log(`Sender: ${sender}`)
  console.log(`Recipient: ${recipient}`)
  console.log(`Amount: ${amount} USDC`)
}

function arcTransactionUrl(transactionId: string): string {
  return `${ARC_EXPLORER_TRANSACTION_URL}/${transactionId}`
}

function aleoTransactionUrl(transactionId: string): string {
  return `${ALEO_EXPLORER_TRANSACTION_URL}/${transactionId}`
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function integerEnvironmentVariable(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`)
  }
  return value
}

function booleanEnvironmentVariable(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${name} must be true or false`)
}

function mintModeFromEnvironment(): Extract<AleoMintMode, 'public' | 'private'> {
  const value = process.env.USDCX_MINT_MODE?.trim() || 'public'
  if (value !== 'public' && value !== 'private') {
    throw new Error('USDCX_MINT_MODE must be public or private')
  }
  return value
}

function privateMintSecretNonceFromEnvironment(mintMode: AleoMintMode): string | undefined {
  const raw = process.env.USDCX_SECRET_NONCE?.trim()
  if (!raw) return undefined
  if (mintMode !== 'private') throw new Error('USDCX_SECRET_NONCE is only valid when USDCX_MINT_MODE=private')
  const scalar = /^[0-9]+$/.test(raw) ? `${raw}scalar` : raw
  if (!/^(0|[1-9][0-9]*)scalar$/.test(scalar)) {
    throw new Error('USDCX_SECRET_NONCE must be a non-negative decimal value, optionally followed by scalar')
  }
  return scalar
}

function privateKeyFromEnvironment(): Hex {
  const value = requiredEnvironmentVariable('EVM_PRIVATE_KEY')
  const unprefixed = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
  if (!/^[0-9a-f]{64}$/i.test(unprefixed)) {
    throw new Error('EVM_PRIVATE_KEY must contain exactly 32 bytes (64 hexadecimal characters), with or without a 0x prefix')
  }
  return `0x${unprefixed}` as Hex
}

function positionalParameters(params: readonly unknown[] | Record<string, unknown> | undefined, method: string): readonly unknown[] {
  if (!Array.isArray(params)) throw new Error(`${method} requires positional parameters`)
  return params
}

function callParameter(value: unknown): { to: Address, data: Hex } {
  if (!value || typeof value !== 'object') throw new Error('The RPC method requires a transaction object')
  const transaction = value as Record<string, unknown>
  if (typeof transaction.to !== 'string' || !isAddress(transaction.to)) throw new Error('Transaction destination is invalid')
  if (typeof transaction.data !== 'string' || !isHex(transaction.data)) throw new Error('Transaction calldata is invalid')
  return { to: getAddress(transaction.to), data: transaction.data }
}

function transactionParameter(value: unknown): { from: Address, to: Address, data: Hex } {
  const transaction = value as Record<string, unknown>
  const call = callParameter(value)
  if (typeof transaction.from !== 'string' || !isAddress(transaction.from)) throw new Error('Transaction sender is invalid')
  return { from: getAddress(transaction.from), ...call }
}

function createArcExecutor(rpcUrl: string, privateKey: Hex): {
  executor: EvmBridgeExecutor
  publicClient: ReturnType<typeof createPublicClient>
} {
  const arc = defineChain({
    id: ARC_CHAIN_ID,
    name: 'Arc Mainnet',
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  })
  const transport = http(rpcUrl)
  const publicClient = createPublicClient({ chain: arc, transport })
  const account = privateKeyToAccount(privateKey)
  const sender = getAddress(account.address)
  const expectedSender = process.env.ARC_SENDER?.trim()
  if (expectedSender && (!isAddress(expectedSender) || getAddress(expectedSender) !== sender)) {
    throw new Error(`EVM_PRIVATE_KEY resolves to ${sender}, but ARC_SENDER is ${expectedSender}`)
  }
  const walletClient = createWalletClient({ account, chain: arc, transport })

  const executor: EvmBridgeExecutor = {
    account: sender,
    request: async ({ method, params }) => {
      if (method === 'eth_accounts') return [sender]
      if (method === 'eth_chainId') return `0x${(await publicClient.getChainId()).toString(16)}`
      if (method === 'eth_call') {
        const values = positionalParameters(params, method)
        const transaction = callParameter(values[0])
        const result = await publicClient.call({ account: sender, to: transaction.to, data: transaction.data })
        return result.data ?? '0x'
      }
      if (method === 'eth_sendTransaction') {
        const values = positionalParameters(params, method)
        const transaction = transactionParameter(values[0])
        if (transaction.from !== getAddress(account.address)) {
          throw new Error(`Transaction sender ${transaction.from} does not match ${account.address}`)
        }
        await publicClient.call({ account, to: transaction.to, data: transaction.data })
        const gas = await publicClient.estimateGas({ account, to: transaction.to, data: transaction.data })
        verboseLog(`Simulation succeeded: to=${transaction.to} selector=${transaction.data.slice(0, 10)} estimatedGas=${gas}`)
        const hash = await walletClient.sendTransaction({ account, chain: arc, to: transaction.to, data: transaction.data, gas })
        verboseLog('Broadcast Arc transaction:', hash)
        console.log(`Arc transaction: ${arcTransactionUrl(hash)}`)
        return hash
      }
      if (method === 'eth_getTransactionReceipt') {
        const values = positionalParameters(params, method)
        const hash = values[0]
        if (typeof hash !== 'string' || !isHash(hash)) throw new Error('Transaction hash is invalid')
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash })
          return {
            status: receipt.status === 'success' ? '0x1' : '0x0',
            transactionHash: receipt.transactionHash,
            logs: receipt.logs.map((log) => ({
              address: log.address,
              data: log.data,
              topics: log.topics,
              logIndex: log.logIndex,
            })),
          }
        } catch (error) {
          if (error instanceof TransactionReceiptNotFoundError) return null
          throw error
        }
      }
      throw new Error(`Unsupported EVM executor method: ${method}`)
    },
  }
  return { executor, publicClient }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function createPrivateMintContext(recipient: string): Promise<PrivateMintContext> {
  const privateKey = requiredEnvironmentVariable('ALEO_PRIVATE_KEY')
  const networkUrl = process.env.ALEO_RPC_URL?.trim() || 'https://api.provable.com/v2'
  const provingMode = process.env.ALEO_PROVING_MODE?.trim() || 'delegated'
  if (provingMode !== 'delegated') {
    throw new Error('USDCx private mint requires ALEO_PROVING_MODE=delegated; local WASM proving is not supported for this circuit')
  }
  const consumerId = process.env.ALEO_CONSUMER_ID?.trim()
  const apiKey = process.env.ALEO_DPS_API_KEY?.trim()
  if ((consumerId && !apiKey) || (!consumerId && apiKey)) {
    throw new Error('ALEO_CONSUMER_ID and ALEO_DPS_API_KEY must be supplied together')
  }

  verboseLog('\nPrivate mint selected; validating the Aleo signer before submitting private_mint.')
  const { loadNetwork } = await import('@provablehq/veil-aleo-sdk')
  const aleo = await loadNetwork('mainnet')
  const { walletClient, account } = aleo.createAleoClient({
    privateKey,
    networkUrl,
    provingMode,
    ...(process.env.ALEO_PROVER_URL?.trim()
      ? { proverUrl: process.env.ALEO_PROVER_URL.trim() }
      : {}),
    ...(consumerId && apiKey ? { consumerId, apiKey } : {}),
    useFeeMaster: booleanEnvironmentVariable('ALEO_USE_FEE_MASTER', true),
    confirmationTimeout: integerEnvironmentVariable(
      'ALEO_EXECUTION_CONFIRMATION_TIMEOUT_MS',
      DEFAULT_ALEO_EXECUTION_CONFIRMATION_TIMEOUT_MS,
      1_000,
    ),
  })
  if (account.address !== recipient) {
    throw new Error(`ALEO_PRIVATE_KEY resolves to ${account.address}, but ALEO_RECIPIENT is ${recipient}`)
  }
  await walletClient.authenticateProvableApi()
  verboseLog(`Aleo signer ready: ${account.address} (${provingMode} proving)`)
  return {
    executor: {
      executeTransaction: async ({ program, function: functionName, inputs, privateFee, imports }) => {
        if (imports?.length) {
          throw new Error('The delegated private-mint executor does not accept dynamic import names')
        }
        const startedAt = Date.now()
        const progress = setInterval(() => {
          const elapsedSeconds = Math.round((Date.now() - startedAt) / 1_000)
          verboseLog(`Delegated Aleo proving is still in progress (${elapsedSeconds}s elapsed).`)
        }, ALEO_PROVING_PROGRESS_INTERVAL_MS)
        try {
          verboseLog('Requesting the private_mint proof from the delegated proving service.')
          const result = await walletClient.executeContract({
            program,
            function: functionName,
            inputs,
            privateFee,
          })
          verboseLog('The delegated proof was broadcast and the Aleo transaction was accepted.')
          return result.transactionId
        } finally {
          clearInterval(progress)
        }
      },
    },
    transactionStatus: async (params) => {
      const result = await walletClient.transactionStatus(params)
      if (result.status !== 'accepted' && result.status !== 'rejected' && result.status !== 'pending' && result.status !== 'not_found') {
        throw new Error(`Aleo wallet returned an unsupported transaction status: ${result.status}`)
      }
      return { status: result.status, transactionId: result.transactionId ?? params.transactionId }
    },
  }
}

async function waitForAleoTransaction(
  context: PrivateMintContext,
  transactionId: string,
): Promise<AleoTransactionStatus> {
  const pollIntervalMs = integerEnvironmentVariable(
    'ALEO_TRANSACTION_POLL_INTERVAL_MS',
    DEFAULT_ALEO_TRANSACTION_POLL_INTERVAL_MS,
    1_000,
  )
  const timeoutMs = integerEnvironmentVariable(
    'ALEO_TRANSACTION_TIMEOUT_MS',
    DEFAULT_ALEO_TRANSACTION_TIMEOUT_MS,
    0,
  )
  const deadline = Date.now() + timeoutMs
  while (true) {
    const { status } = await context.transactionStatus({ transactionId })
    if (status === 'accepted' || status === 'rejected') return status
    if (Date.now() >= deadline) return status
    verboseLog(`Aleo private_mint status: ${status}; checking again in ${pollIntervalMs} ms.`)
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())))
  }
}

async function executePrivateMint(
  context: PrivateMintContext,
  plan: BridgeTransferPlan,
  deposit: BridgeTransferReceipt,
  attestation: CompletedXReserveAttestation,
): Promise<void> {
  const aleoBridge = createBridgeClient({
    environment: 'mainnet',
    executors: { aleo: context.executor },
  })
  verboseLog('Circle attestation status: complete')
  verboseLog('Submitting shielded_usdcx_wrapper.aleo/private_mint with the configured Aleo signer.')
  const mint = await aleoBridge.executeXReservePrivateMint({
    plan,
    deposit,
    attestation,
    privateFee: booleanEnvironmentVariable('ALEO_PRIVATE_FEE', false),
  })
  verboseLog('Aleo private_mint transaction:', mint.transactionId)
  console.log(`Aleo transaction: ${aleoTransactionUrl(mint.transactionId)}`)
  const status = await waitForAleoTransaction(context, mint.transactionId)
  if (status === 'rejected') throw new Error(`Aleo private_mint was rejected: ${mint.transactionId}`)
  if (status === 'accepted') {
    verboseLog('Aleo private_mint status: accepted')
    verboseLog('The private USDCx record belongs to the configured Aleo recipient.')
    console.log('Transaction completed.')
  } else {
    console.log(`Aleo private_mint monitoring stopped with status ${status}; the submitted transaction may still confirm.`)
    verboseLog('Transaction id:', mint.transactionId)
  }
}

function amountFromXReservePayload(payload: Hex): string {
  if (payload.length !== 2 + (305 * 2)) throw new Error('Circle attestation payload must contain 305 bytes')
  const amountStart = 2 + (8 * 2)
  const amountEnd = amountStart + (32 * 2)
  return formatUnits(BigInt(`0x${payload.slice(amountStart, amountEnd)}`), 6)
}

function senderFromXReservePayload(payload: Hex): Address {
  if (payload.length !== 2 + (305 * 2)) throw new Error('Circle attestation payload must contain 305 bytes')
  const depositorStart = 2 + ((140 + 12) * 2)
  const depositorEnd = 2 + (172 * 2)
  return getAddress(`0x${payload.slice(depositorStart, depositorEnd)}`)
}

async function resumePrivateMint(
  messageHash: Hash,
  recipient: string,
  privateMintSecretNonce: string | undefined,
): Promise<void> {
  const bridge = createBridgeClient({
    environment: 'mainnet',
    xReserveHttpTransport: (url, init) => fetch(url, init),
  })
  const attestation = await bridge.getXReserveAttestation({ routeId: ROUTE_ID, messageHash })
  if (attestation.status !== 'complete') {
    throw new Error(`Circle attestation is still pending: https://xreserve-api.circle.com/v1/attestations/${messageHash}`)
  }
  const secretNonce = privateMintSecretNonce ?? '0scalar'
  const expectedHookData = await buildXReserveHookData('private', recipient, 'mainnet', secretNonce)
  const attestedHookData = `0x${attestation.payload.slice(-130)}`
  if (attestedHookData.toLowerCase() !== expectedHookData.toLowerCase()) {
    throw new Error('ALEO_RECIPIENT and USDCX_SECRET_NONCE do not reproduce the attested private-mint hook')
  }
  const plan = bridge.prepareTransfer({
    routeId: ROUTE_ID,
    amount: amountFromXReservePayload(attestation.payload),
    recipient,
    mintMode: 'private',
    ...(privateMintSecretNonce ? { privateMintSecretNonce } : {}),
  })
  const sender = senderFromXReservePayload(attestation.payload)
  printTransferSummary(sender, recipient, plan.amountIn)
  if (VERBOSE) {
    console.log('\nResume-only Arc private-mint preflight')
    console.table({
      route: plan.route.id,
      sender,
      recipient,
      amount: `${plan.amountIn} USDC`,
      circleMessageHash: messageHash,
      privateMintSecretNonce: privateMintSecretNonce ? 'custom (verified)' : '0scalar (verified default)',
      arcDeposit: 'skipped; using the existing Circle-attested deposit',
    })
  }
  if (process.env.EXECUTE_XRESERVE_PRIVATE_MINT !== PRIVATE_MINT_ACKNOWLEDGEMENT) {
    console.log('\nResume preflight complete; no Aleo transaction was submitted.')
    console.log(`Set EXECUTE_XRESERVE_PRIVATE_MINT=${PRIVATE_MINT_ACKNOWLEDGEMENT} to submit only private_mint.`)
    return
  }
  console.log('\nTransaction in progress...')
  const context = await createPrivateMintContext(recipient)
  const deposit: BridgeTransferReceipt = {
    id: messageHash,
    protocol: 'xreserve',
    status: 'ATTESTATION_PENDING',
    protocolState: {
      routeId: ROUTE_ID,
      mintMode: 'private',
      intendedRecipient: recipient,
      payload: attestation.payload,
      messageHash,
    },
  }
  await executePrivateMint(context, plan, deposit, attestation)
}

async function waitForAttestation(
  bridge: ReturnType<typeof createBridgeClient>,
  messageHash: Hash,
): Promise<Extract<XReserveAttestationResult, { status: 'complete' }> | undefined> {
  const interval = integerEnvironmentVariable('ATTESTATION_POLL_INTERVAL_MS', DEFAULT_ATTESTATION_POLL_INTERVAL_MS, 1_000)
  const timeout = integerEnvironmentVariable('ATTESTATION_TIMEOUT_MS', DEFAULT_ATTESTATION_TIMEOUT_MS, 0)
  const deadline = Date.now() + timeout
  while (true) {
    const result = await bridge.getXReserveAttestation({ routeId: ROUTE_ID, messageHash })
    if (result.status === 'complete') return result
    if (Date.now() >= deadline) return undefined
    verboseLog(`Circle attestation: pending; checking again in ${interval} ms.`)
    await delay(Math.min(interval, Math.max(0, deadline - Date.now())))
  }
}

async function waitForPublicMint(sender: Address, recipient: string, messageHash: Hash): Promise<void> {
  const interval = integerEnvironmentVariable('MINT_POLL_INTERVAL_MS', DEFAULT_MINT_POLL_INTERVAL_MS, 1_000)
  const timeout = integerEnvironmentVariable('MINT_TIMEOUT_MS', DEFAULT_MINT_TIMEOUT_MS, 0)
  const deadline = Date.now() + timeout
  const url = `https://api.usdcx.aleo.org/api/mints?minterEthAddress=${sender}&evmChain=arc`
  while (true) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Aleo mint monitor failed with HTTP ${response.status}`)
    const entries = await response.json() as ArcMintHistoryEntry[]
    const entry = entries.find((value) => value.attestationMessageHash?.toLowerCase() === messageHash.toLowerCase())
    if (entry) {
      if (entry.aleoAddress && entry.aleoAddress !== recipient) throw new Error('Aleo mint monitor returned a different recipient')
      if (entry.mintExecution?.executionType && entry.mintExecution.executionType !== 'public') {
        throw new Error(`Aleo mint monitor returned execution type ${entry.mintExecution.executionType}`)
      }
      const status = entry.aleo?.status
      if (status === 'MintTxAccepted') {
        verboseLog('Aleo public mint status: accepted')
        verboseLog('Aleo mint transaction:', entry.aleo?.aleoMintTxId)
        if (entry.aleo?.aleoMintTxId) {
          console.log(`Aleo transaction: ${aleoTransactionUrl(entry.aleo.aleoMintTxId)}`)
        }
        console.log('Transaction completed.')
        return
      }
      if (status === 'MintTxRejected' || status === 'Failed') throw new Error(`Aleo public mint ended with status ${status}`)
      verboseLog(`Aleo public mint status: ${status ?? 'indexed'}; checking again in ${interval} ms.`)
    } else {
      verboseLog(`Aleo public mint: not indexed yet; checking again in ${interval} ms.`)
    }
    if (Date.now() >= deadline) {
      console.log('Aleo mint monitoring timed out; the courtesy backend continues independently.')
      console.log('Monitor URL:', url)
      return
    }
    await delay(Math.min(interval, Math.max(0, deadline - Date.now())))
  }
}

/** Runs the Arc USDC to Aleo USDCx example. */
export async function runArcToAleoExample(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: pnpm tsx examples/bridge/arc-to-aleo.ts [--verbose]')
    return
  }
  const recipient = requiredEnvironmentVariable('ALEO_RECIPIENT')
  const mintMode = mintModeFromEnvironment()
  const privateMintSecretNonce = privateMintSecretNonceFromEnvironment(mintMode)
  const resumeMessageHash = process.env.XRESERVE_RESUME_MESSAGE_HASH?.trim()
  if (resumeMessageHash) {
    if (mintMode !== 'private') throw new Error('XRESERVE_RESUME_MESSAGE_HASH requires USDCX_MINT_MODE=private')
    if (!isHash(resumeMessageHash)) throw new Error('XRESERVE_RESUME_MESSAGE_HASH must be a 32-byte 0x-prefixed Circle message hash')
    await resumePrivateMint(resumeMessageHash, recipient, privateMintSecretNonce)
    return
  }

  const rpcUrl = requiredEnvironmentVariable('ARC_RPC_URL')
  const amount = process.env.USDC_AMOUNT?.trim() || '5'
  const execute = process.env.EXECUTE_XRESERVE_DEPOSIT === EXECUTION_ACKNOWLEDGEMENT
  const privateKey = privateKeyFromEnvironment()
  const { executor, publicClient } = createArcExecutor(rpcUrl, privateKey)
  const sender = executor.account
  if (!sender) throw new Error('The local signer did not expose an Arc account')

  const [chainId, reserveCode, tokenCode, nativeBalance, sourceDomain, remoteDepositor] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBytecode({ address: XRESERVE_CONTRACT }),
    publicClient.getBytecode({ address: USDC_CONTRACT }),
    publicClient.getBalance({ address: sender }),
    publicClient.readContract({ address: XRESERVE_CONTRACT, abi: XRESERVE_READ_ABI, functionName: 'domain' }),
    publicClient.readContract({ address: XRESERVE_CONTRACT, abi: XRESERVE_READ_ABI, functionName: 'getRemoteDomainDepositor', args: [ALEO_REMOTE_DOMAIN] }),
  ])
  if (chainId !== ARC_CHAIN_ID) throw new Error(`Arc RPC returned chain ${chainId}; expected ${ARC_CHAIN_ID}`)
  if (!reserveCode || reserveCode === '0x') throw new Error(`No xReserve bytecode at ${XRESERVE_CONTRACT}`)
  if (!tokenCode || tokenCode === '0x') throw new Error(`No USDC bytecode at ${USDC_CONTRACT}`)
  if (sourceDomain !== ARC_SOURCE_DOMAIN) throw new Error(`xReserve reports source domain ${sourceDomain}; expected ${ARC_SOURCE_DOMAIN}`)
  if (remoteDepositor === '0x0000000000000000000000000000000000000000') throw new Error('Aleo remote domain is not registered')

  const bridge = createBridgeClient({
    environment: 'mainnet',
    executors: { evm: executor },
    xReserveHttpTransport: (url, init) => fetch(url, init),
  })
  const plan = bridge.prepareTransfer({
    routeId: ROUTE_ID,
    amount,
    recipient,
    sender,
    mintMode,
    ...(privateMintSecretNonce ? { privateMintSecretNonce } : {}),
  })
  const quote = await bridge.quoteEvmXReserveTransfer({ plan })

  const formattedAmount = formatUnits(quote.amountAtomic, 6)
  printTransferSummary(sender, recipient, formattedAmount)
  if (VERBOSE) {
    console.log(`\nRead-only Arc xReserve ${mintMode}-mint preflight`)
    console.table({
      route: quote.routeId,
      chainId,
      sourceDomain,
      sender,
      recipient,
      mintMode,
      destinationOperation: mintMode === 'private'
        ? 'shielded_usdcx_wrapper.aleo/private_mint'
        : 'usdcx_bridge_v2.aleo/mint_public',
      privateMintSecretNonce: mintMode === 'private'
        ? privateMintSecretNonce ? 'custom' : '0scalar (default)'
        : 'not applicable',
      amount: `${formattedAmount} USDC`,
      tokenBalance: `${formatUnits(quote.balanceAtomic, 6)} USDC`,
      nativeGasBalance: `${formatUnits(nativeBalance, 18)} USDC`,
      allowance: `${formatUnits(quote.allowanceAtomic, 6)} USDC`,
      approvalRequired: quote.approvalRequired,
      xReserveContract: quote.xReserveContract,
      remoteDomain: quote.remoteDomain,
      remoteDomainDepositor: remoteDepositor,
      maxFee: `${formatUnits(quote.maxFeeAtomic, 6)} USDC`,
      minimumRecipientAmount: `${formatUnits(quote.amountAtomic - quote.maxFeeAtomic, 6)} USDCx`,
    })
    console.log('\nVerified contract call')
    console.log('Function:', DEPOSIT_SIGNATURE)
    console.log('Selector:', DEPOSIT_SELECTOR)
    console.log('Arguments:', {
      value: quote.amountAtomic.toString(),
      remoteDomain: quote.remoteDomain,
      remoteRecipient: quote.remoteRecipientBytes32,
      localToken: quote.tokenAddress,
      maxFee: quote.maxFeeAtomic.toString(),
      hookData: quote.hookData,
    })
  }

  if (!execute) {
    console.log('\nPreflight complete; no USDC was deposited.')
    console.log(`Set EXECUTE_XRESERVE_DEPOSIT=${EXECUTION_ACKNOWLEDGEMENT} to execute.`)
    return
  }

  const privateMintContext = mintMode === 'private'
    ? await createPrivateMintContext(recipient)
    : undefined

  verboseLog('\nExecution enabled. Each transaction will be simulated before local signing and broadcast.')
  console.log('\nTransaction in progress...')
  const execution = await bridge.executeEvmXReserveTransfer({ plan, confirmationTimeoutMs: 5 * 60_000 })
  verboseLog('Approval transaction(s):', execution.approvalTxIds)
  verboseLog('Deposit transaction:', execution.receipt.sourceTxId)
  verboseLog('Transfer status:', execution.receipt.status)
  if (execution.receipt.status !== 'ATTESTATION_PENDING' || !isHash(execution.receipt.id)) {
    console.log('The transfer is resumable from the status and transaction identifiers above.')
    return
  }

  const messageHash = execution.receipt.id
  verboseLog('Circle message hash:', messageHash)
  const attestation = await waitForAttestation(bridge, messageHash)
  if (!attestation) {
    console.log('Circle attestation monitoring timed out; protocol processing continues independently.')
    console.log(`Resume at https://xreserve-api.circle.com/v1/attestations/${messageHash}`)
    if (mintMode === 'private') {
      console.log('The Arc deposit is final, but private_mint still requires an Aleo signer.')
      console.log('Resume with XRESERVE_RESUME_MESSAGE_HASH set to the Circle message hash above.')
    }
    return
  }
  if (mintMode === 'private') {
    if (!privateMintContext) throw new Error('Private mint signer was not initialized')
    await executePrivateMint(privateMintContext, plan, execution.receipt, attestation)
  } else {
    verboseLog('Circle attestation status: complete')
    await waitForPublicMint(sender, recipient, messageHash)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runArcToAleoExample().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
