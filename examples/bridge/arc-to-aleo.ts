/**
 * Quotes or submits a mainnet Arc USDC to Aleo public USDCx xReserve mint.
 *
 * Run without EXECUTE_XRESERVE_DEPOSIT for a read-only preflight. Live
 * execution reads the Arc private key from a permission-restricted file,
 * simulates every transaction, and requires an explicit acknowledgement.
 */

import { readFileSync, statSync } from 'node:fs'
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
import {
  createBridgeClient,
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
const DEFAULT_KEY_FILE = '/tmp/veil-arc-evm-key'
const DEFAULT_ATTESTATION_POLL_INTERVAL_MS = 10_000
const DEFAULT_ATTESTATION_TIMEOUT_MS = 30 * 60_000
const DEFAULT_MINT_POLL_INTERVAL_MS = 10_000
const DEFAULT_MINT_TIMEOUT_MS = 30 * 60_000

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

function senderFromEnvironment(): Address {
  const value = requiredEnvironmentVariable('ARC_SENDER')
  if (!isAddress(value)) throw new Error('ARC_SENDER must be an EVM address')
  return getAddress(value)
}

function privateKeyFromFile(expectedSender: Address): Hex {
  const path = process.env.ARC_PRIVATE_KEY_FILE?.trim() || DEFAULT_KEY_FILE
  const file = statSync(path)
  if (!file.isFile()) throw new Error(`ARC_PRIVATE_KEY_FILE is not a regular file: ${path}`)
  if ((file.mode & 0o077) !== 0) throw new Error(`ARC_PRIVATE_KEY_FILE must not be accessible by group or other users: ${path}`)
  const value = readFileSync(path, 'utf8').trim()
  const unprefixed = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
  if (!/^[0-9a-f]{64}$/i.test(unprefixed)) {
    throw new Error('ARC_PRIVATE_KEY_FILE must contain exactly 32 bytes (64 hexadecimal characters), with or without a 0x prefix')
  }
  const privateKey = `0x${unprefixed}` as Hex
  const actualSender = privateKeyToAccount(privateKey).address
  if (getAddress(actualSender) !== expectedSender) {
    throw new Error(`Arc private key resolves to ${actualSender}, but ARC_SENDER is ${expectedSender}`)
  }
  return privateKey
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

function createArcExecutor(rpcUrl: string, sender: Address, privateKey?: Hex): {
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
  const account = privateKey ? privateKeyToAccount(privateKey) : undefined
  const walletClient = account ? createWalletClient({ account, chain: arc, transport }) : undefined

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
        if (!account || !walletClient) throw new Error('Live execution requires ARC_PRIVATE_KEY_FILE')
        const values = positionalParameters(params, method)
        const transaction = transactionParameter(values[0])
        if (transaction.from !== getAddress(account.address)) {
          throw new Error(`Transaction sender ${transaction.from} does not match ${account.address}`)
        }
        await publicClient.call({ account, to: transaction.to, data: transaction.data })
        const gas = await publicClient.estimateGas({ account, to: transaction.to, data: transaction.data })
        console.log(`Simulation succeeded: to=${transaction.to} selector=${transaction.data.slice(0, 10)} estimatedGas=${gas}`)
        const hash = await walletClient.sendTransaction({ account, chain: arc, to: transaction.to, data: transaction.data, gas })
        console.log('Broadcast Arc transaction:', hash)
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
    console.log(`Circle attestation: pending; checking again in ${interval} ms.`)
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
        console.log('Aleo public mint status: accepted')
        console.log('Aleo mint transaction:', entry.aleo?.aleoMintTxId)
        return
      }
      if (status === 'MintTxRejected' || status === 'Failed') throw new Error(`Aleo public mint ended with status ${status}`)
      console.log(`Aleo public mint status: ${status ?? 'indexed'}; checking again in ${interval} ms.`)
    } else {
      console.log(`Aleo public mint: not indexed yet; checking again in ${interval} ms.`)
    }
    if (Date.now() >= deadline) {
      console.log('Aleo mint monitoring timed out; the courtesy backend continues independently.')
      console.log('Monitor URL:', url)
      return
    }
    await delay(Math.min(interval, Math.max(0, deadline - Date.now())))
  }
}

async function main(): Promise<void> {
  const rpcUrl = requiredEnvironmentVariable('ARC_RPC_URL')
  const sender = senderFromEnvironment()
  const recipient = requiredEnvironmentVariable('ALEO_RECIPIENT')
  const amount = process.env.USDC_AMOUNT?.trim() || '5'
  const execute = process.env.EXECUTE_XRESERVE_DEPOSIT === EXECUTION_ACKNOWLEDGEMENT
  const privateKey = execute ? privateKeyFromFile(sender) : undefined
  const { executor, publicClient } = createArcExecutor(rpcUrl, sender, privateKey)

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
  const plan = bridge.prepareTransfer({ routeId: ROUTE_ID, amount, recipient, sender, mintMode: 'public' })
  const quote = await bridge.quoteEvmXReserveTransfer({ plan })

  console.log('Read-only Arc xReserve public-mint preflight')
  console.table({
    route: quote.routeId,
    chainId,
    sourceDomain,
    sender,
    recipient,
    amount: `${formatUnits(quote.amountAtomic, 6)} USDC`,
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

  if (!execute) {
    console.log('\nPreflight complete; no transaction was submitted and the private key was not read.')
    console.log(`Set EXECUTE_XRESERVE_DEPOSIT=${EXECUTION_ACKNOWLEDGEMENT} to execute.`)
    return
  }

  console.log('\nExecution enabled. Each transaction will be simulated before local signing and broadcast.')
  const execution = await bridge.executeEvmXReserveTransfer({ plan, confirmationTimeoutMs: 5 * 60_000 })
  console.log('Approval transaction(s):', execution.approvalTxIds)
  console.log('Deposit transaction:', execution.receipt.sourceTxId)
  console.log('Transfer status:', execution.receipt.status)
  if (execution.receipt.status !== 'ATTESTATION_PENDING' || !isHash(execution.receipt.id)) {
    console.log('The transfer is resumable from the status and transaction identifiers above.')
    return
  }

  const messageHash = execution.receipt.id
  console.log('Circle message hash:', messageHash)
  const attestation = await waitForAttestation(bridge, messageHash)
  if (!attestation) {
    console.log('Circle attestation monitoring timed out; protocol processing continues independently.')
    console.log(`Resume at https://xreserve-api.circle.com/v1/attestations/${messageHash}`)
    return
  }
  console.log('Circle attestation status: complete')
  await waitForPublicMint(sender, recipient, messageHash)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
