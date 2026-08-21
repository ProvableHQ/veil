/**
 * Quotes or submits a mainnet Ethereum USDC to Aleo USDCx xReserve deposit.
 *
 * Run without EXECUTE_XRESERVE_DEPOSIT for a read-only preflight. The private
 * key signs locally through viem and is never sent to Veil or the RPC server.
 */

import {
  TransactionReceiptNotFoundError,
  createPublicClient,
  createWalletClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  isHash,
  isHex,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import {
  createBridgeClient,
  type AleoBridgeExecutor,
  type AleoMintMode,
  type BridgeTransferPlan,
  type BridgeTransferReceipt,
  type EvmBridgeExecutor,
  type XReserveAttestationResult,
} from '@provablehq/veil-aleo-bridges'

const ROUTE_ID = 'xreserve:ethereum/usdc->aleo/usdcx'
const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const PRIVATE_MINT_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_SUBMITS_AN_ALEO_PRIVATE_MINT'
const DEFAULT_ATTESTATION_POLL_INTERVAL_MS = 10_000
const DEFAULT_ATTESTATION_TIMEOUT_MS = 30 * 60_000
const DEFAULT_ALEO_TRANSACTION_POLL_INTERVAL_MS = 5_000
const DEFAULT_ALEO_TRANSACTION_TIMEOUT_MS = 5 * 60_000
const DEFAULT_ALEO_EXECUTION_CONFIRMATION_TIMEOUT_MS = 5 * 60_000
const ALEO_PROVING_PROGRESS_INTERVAL_MS = 15_000

type CompletedXReserveAttestation = Extract<XReserveAttestationResult, { status: 'complete' }>
type AleoTransactionStatus = 'accepted' | 'rejected' | 'pending' | 'not_found'
type PrivateMintContext = {
  executor: AleoBridgeExecutor
  transactionStatus: (params: { transactionId: string }) => Promise<{
    status: AleoTransactionStatus
    transactionId: string
  }>
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function privateKeyFromEnvironment(): Hex {
  const value = requiredEnvironmentVariable('EVM_PRIVATE_KEY')
  const unprefixed = value.startsWith('0x') || value.startsWith('0X')
    ? value.slice(2)
    : value
  if (!/^[0-9a-f]{64}$/i.test(unprefixed)) {
    throw new Error('EVM_PRIVATE_KEY must contain exactly 32 bytes (64 hexadecimal characters), with or without a 0x prefix')
  }
  return `0x${unprefixed}` as Hex
}

function mintModeFromEnvironment(): AleoMintMode {
  const value = requiredEnvironmentVariable('USDCX_MINT_MODE')
  if (value !== 'public' && value !== 'record' && value !== 'private') {
    throw new Error('USDCX_MINT_MODE must be public, record, or private')
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

function millisecondsFromEnvironment(name: string, defaultValue: number, minimum: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return defaultValue
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`)
  }
  return value
}

function booleanFromEnvironment(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return defaultValue
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${name} must be true or false`)
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function positionalParameters(
  params: readonly unknown[] | Record<string, unknown> | undefined,
  method: string,
): readonly unknown[] {
  if (!Array.isArray(params)) throw new Error(`${method} requires positional parameters`)
  return params
}

function callParameter(value: unknown): { to: Address, data: Hex } {
  if (!value || typeof value !== 'object') throw new Error('The RPC method requires a transaction object')
  const transaction = value as Record<string, unknown>
  if (typeof transaction.to !== 'string' || !isAddress(transaction.to)) throw new Error('Transaction destination is invalid')
  if (typeof transaction.data !== 'string' || !isHex(transaction.data)) throw new Error('Transaction calldata is invalid')
  return {
    to: getAddress(transaction.to),
    data: transaction.data,
  }
}

function transactionParameter(value: unknown): { from: Address, to: Address, data: Hex } {
  const call = callParameter(value)
  const transaction = value as Record<string, unknown>
  if (typeof transaction.from !== 'string' || !isAddress(transaction.from)) throw new Error('Transaction sender is invalid')
  return { from: getAddress(transaction.from), ...call }
}

function createLocalSignerExecutor(rpcUrl: string, privateKey: Hex): EvmBridgeExecutor {
  const account = privateKeyToAccount(privateKey)
  const transport = http(rpcUrl)
  const publicClient = createPublicClient({ chain: mainnet, transport })
  const walletClient = createWalletClient({ account, chain: mainnet, transport })

  return {
    account: account.address,
    request: async ({ method, params }) => {
      if (method === 'eth_accounts') return [account.address]
      if (method === 'eth_chainId') {
        const chainId = await publicClient.getChainId()
        return `0x${chainId.toString(16)}`
      }
      if (method === 'eth_call') {
        const values = positionalParameters(params, method)
        const transaction = callParameter(values[0])
        const result = await publicClient.call({ to: transaction.to, data: transaction.data })
        return result.data ?? '0x'
      }
      if (method === 'eth_sendTransaction') {
        const values = positionalParameters(params, method)
        const transaction = transactionParameter(values[0])
        if (transaction.from !== getAddress(account.address)) {
          throw new Error(`Transaction sender ${transaction.from} does not match ${account.address}`)
        }
        const hash = await walletClient.sendTransaction({
          account,
          chain: mainnet,
          to: transaction.to,
          data: transaction.data,
        })
        console.log('Broadcast Ethereum transaction:', hash)
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
}

async function createPrivateMintContext(recipient: string): Promise<PrivateMintContext> {
  const privateKey = requiredEnvironmentVariable('ALEO_PRIVATE_KEY')
  const networkUrl = process.env.ALEO_RPC_URL?.trim() || 'https://api.provable.com/v2'
  const provingModeValue = process.env.ALEO_PROVING_MODE?.trim() || 'delegated'
  if (provingModeValue !== 'delegated') {
    throw new Error('USDCx private mint requires ALEO_PROVING_MODE=delegated; local WASM proving is not supported for this circuit')
  }
  const consumerId = process.env.ALEO_CONSUMER_ID?.trim()
  const apiKey = process.env.ALEO_DPS_API_KEY?.trim()
  if ((consumerId && !apiKey) || (!consumerId && apiKey)) {
    throw new Error('ALEO_CONSUMER_ID and ALEO_DPS_API_KEY must be supplied together')
  }

  console.log('\nPrivate mint selected; validating the Aleo signer before submitting private_mint.')
  const { loadNetwork } = await import('@provablehq/veil-aleo-sdk')
  const aleo = await loadNetwork('mainnet')
  const { walletClient, account } = aleo.createAleoClient({
    privateKey,
    networkUrl,
    provingMode: provingModeValue,
    ...(process.env.ALEO_PROVER_URL?.trim()
      ? { proverUrl: process.env.ALEO_PROVER_URL.trim() }
      : {}),
    ...(consumerId && apiKey ? { consumerId, apiKey } : {}),
    useFeeMaster: booleanFromEnvironment('ALEO_USE_FEE_MASTER', true),
    confirmationTimeout: millisecondsFromEnvironment(
      'ALEO_EXECUTION_CONFIRMATION_TIMEOUT_MS',
      DEFAULT_ALEO_EXECUTION_CONFIRMATION_TIMEOUT_MS,
      1_000,
    ),
  })
  if (account.address !== recipient) {
    throw new Error(`ALEO_PRIVATE_KEY resolves to ${account.address}, but ALEO_RECIPIENT is ${recipient}`)
  }
  await walletClient.authenticateProvableApi()
  console.log(`Aleo signer ready: ${account.address} (${provingModeValue} proving)`)
  return {
    executor: {
      executeTransaction: async ({ program, function: functionName, inputs, privateFee, imports }) => {
        if (imports?.length) {
          throw new Error('The delegated private-mint executor does not accept dynamic import names')
        }
        const startedAt = Date.now()
        const progress = setInterval(() => {
          const elapsedSeconds = Math.round((Date.now() - startedAt) / 1_000)
          console.log(`Delegated Aleo proving is still in progress (${elapsedSeconds}s elapsed).`)
        }, ALEO_PROVING_PROGRESS_INTERVAL_MS)
        try {
          console.log('Requesting the private_mint proof from the delegated proving service.')
          const result = await walletClient.executeContract({
            program,
            function: functionName,
            inputs,
            privateFee,
          })
          console.log('The delegated proof was broadcast and the Aleo transaction was accepted.')
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
  const pollIntervalMs = millisecondsFromEnvironment(
    'ALEO_TRANSACTION_POLL_INTERVAL_MS',
    DEFAULT_ALEO_TRANSACTION_POLL_INTERVAL_MS,
    1_000,
  )
  const timeoutMs = millisecondsFromEnvironment(
    'ALEO_TRANSACTION_TIMEOUT_MS',
    DEFAULT_ALEO_TRANSACTION_TIMEOUT_MS,
    0,
  )
  const deadline = Date.now() + timeoutMs
  while (true) {
    const { status } = await context.transactionStatus({ transactionId })
    if (status === 'accepted' || status === 'rejected') return status
    if (Date.now() >= deadline) return status
    console.log(`Aleo private_mint status: ${status}; checking again in ${pollIntervalMs} ms.`)
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
  console.log('Circle attestation status: complete')
  console.log('Submitting shielded_usdcx_wrapper.aleo/private_mint with the configured Aleo signer.')
  const mint = await aleoBridge.executeXReservePrivateMint({
    plan,
    deposit,
    attestation,
    privateFee: booleanFromEnvironment('ALEO_PRIVATE_FEE', false),
  })
  console.log('Aleo private_mint transaction:', mint.transactionId)
  const status = await waitForAleoTransaction(context, mint.transactionId)
  if (status === 'rejected') throw new Error(`Aleo private_mint was rejected: ${mint.transactionId}`)
  if (status === 'accepted') {
    console.log('Aleo private_mint status: accepted')
    console.log('The private USDCx record belongs to the configured Aleo recipient.')
  } else {
    console.log(`Aleo private_mint monitoring stopped with status ${status}; the submitted transaction may still confirm.`)
    console.log('Transaction id:', mint.transactionId)
  }
}

function amountFromXReservePayload(payload: Hex): string {
  if (payload.length !== 2 + (305 * 2)) throw new Error('Circle attestation payload must contain 305 bytes')
  const amountStart = 2 + (8 * 2)
  const amountEnd = amountStart + (32 * 2)
  return formatUnits(BigInt(`0x${payload.slice(amountStart, amountEnd)}`), 6)
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
  const attestation = await bridge.getXReserveAttestation({
    routeId: ROUTE_ID,
    messageHash,
  })
  if (attestation.status !== 'complete') {
    throw new Error(`Circle attestation is still pending: https://xreserve-api.circle.com/v1/attestations/${messageHash}`)
  }
  const plan = bridge.prepareTransfer({
    routeId: ROUTE_ID,
    amount: amountFromXReservePayload(attestation.payload),
    recipient,
    mintMode: 'private',
    ...(privateMintSecretNonce ? { privateMintSecretNonce } : {}),
  })
  console.log('Resume-only private mint preflight')
  console.table({
    route: plan.route.id,
    recipient,
    amount: `${plan.amountIn} USDC`,
    circleMessageHash: messageHash,
    privateMintSecretNonce: privateMintSecretNonce ? 'custom' : '0scalar (default)',
    ethereumDeposit: 'skipped; using the existing Circle-attested deposit',
  })
  if (process.env.EXECUTE_XRESERVE_PRIVATE_MINT !== PRIVATE_MINT_ACKNOWLEDGEMENT) {
    console.log('\nResume preflight complete; no Aleo transaction was submitted.')
    console.log(`Set EXECUTE_XRESERVE_PRIVATE_MINT=${PRIVATE_MINT_ACKNOWLEDGEMENT} to submit only private_mint.`)
    return
  }
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

async function main(): Promise<void> {
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

  const rpcUrl = requiredEnvironmentVariable('ETHEREUM_RPC_URL')
  const amount = requiredEnvironmentVariable('USDC_AMOUNT')
  const executor = createLocalSignerExecutor(rpcUrl, privateKeyFromEnvironment())
  const sender = executor.account
  if (!sender) throw new Error('The local signer did not expose an Ethereum account')

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

  console.log('Read-only xReserve preflight')
  console.table({
    route: quote.routeId,
    sender,
    recipient,
    mintMode,
    privateMintSecretNonce: mintMode === 'private'
      ? privateMintSecretNonce ? 'custom' : '0scalar (default)'
      : 'not applicable',
    amount: `${formatUnits(quote.amountAtomic, 6)} USDC`,
    balance: `${formatUnits(quote.balanceAtomic, 6)} USDC`,
    allowance: `${formatUnits(quote.allowanceAtomic, 6)} USDC`,
    approvalRequired: quote.approvalRequired,
    xReserveContract: quote.xReserveContract,
    remoteDomain: quote.remoteDomain,
    maxFee: `${formatUnits(quote.maxFeeAtomic, 6)} USDC`,
    remoteRecipientBytes32: quote.remoteRecipientBytes32,
    hookData: quote.hookData,
  })

  if (process.env.EXECUTE_XRESERVE_DEPOSIT !== EXECUTION_ACKNOWLEDGEMENT) {
    console.log('\nQuote complete; no transaction was submitted.')
    console.log(`Set EXECUTE_XRESERVE_DEPOSIT=${EXECUTION_ACKNOWLEDGEMENT} to approve and deposit.`)
    return
  }

  const privateMintContext = mintMode === 'private'
    ? await createPrivateMintContext(recipient)
    : undefined

  console.log('\nExecution enabled. The local viem signer will automatically sign and broadcast the required transactions; no wallet prompt will appear.')
  console.log(quote.approvalRequired
    ? 'Submitting an exact USDC approval, then the xReserve deposit.'
    : 'Existing allowance is sufficient; submitting only the xReserve deposit.')
  const execution = await bridge.executeEvmXReserveTransfer({ plan })
  console.log('Approval transaction(s):', execution.approvalTxIds)
  console.log('Deposit transaction:', execution.receipt.sourceTxId ?? 'pending')
  console.log('Transfer status:', execution.receipt.status)
  console.log('Circle message hash:', execution.receipt.id)

  if (execution.receipt.status === 'ATTESTATION_PENDING') {
    const messageHash = execution.receipt.id
    if (!isHash(messageHash)) throw new Error('The confirmed deposit did not produce a valid Circle message hash')
    const pollIntervalMs = millisecondsFromEnvironment(
      'ATTESTATION_POLL_INTERVAL_MS',
      DEFAULT_ATTESTATION_POLL_INTERVAL_MS,
      1_000,
    )
    const timeoutMs = millisecondsFromEnvironment(
      'ATTESTATION_TIMEOUT_MS',
      DEFAULT_ATTESTATION_TIMEOUT_MS,
      0,
    )
    const deadline = Date.now() + timeoutMs
    const attestationUrl = `https://xreserve-api.circle.com/v1/attestations/${messageHash}`

    console.log('\nThe Ethereum deposit is final. Exiting this process cannot cancel it.')
    console.log(mintMode === 'private'
      ? 'Circle attestation runs independently, but private minting requires this script or another Aleo signer to submit private_mint.'
      : 'Circle attestation and automatic Aleo public/record minting run independently of this monitor.')
    console.log('Monitoring:', attestationUrl)

    while (true) {
      let attestation: XReserveAttestationResult | undefined
      try {
        attestation = await bridge.getXReserveAttestation({
          routeId: plan.route.id,
          messageHash: messageHash as Hash,
        })
      } catch (error) {
        console.warn('Circle attestation check failed; the on-chain deposit remains valid and processing continues.')
        console.warn(error instanceof Error ? error.message : error)
      }

      if (attestation?.status === 'complete') {
        switch (mintMode) {
          case 'public':
          case 'record':
            console.log('Circle attestation status: complete')
            console.log(`The Aleo-side service can now complete the automatic ${mintMode} mint.`)
            console.log('This example confirms the attestation, but does not verify the Aleo mint transaction.')
            break
          case 'private':
            if (!privateMintContext) throw new Error('Private mint signer was not initialized')
            await executePrivateMint(privateMintContext, plan, execution.receipt, attestation)
            break
        }
        break
      }
      if (attestation?.status === 'pending') {
        console.log(`Circle attestation status: pending; checking again in ${pollIntervalMs} ms.`)
      }

      if (Date.now() >= deadline) {
        console.log(`Attestation monitoring stopped after ${timeoutMs} ms; protocol processing continues independently.`)
        console.log('Resume monitoring with:', attestationUrl)
        break
      }
      await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())))
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
