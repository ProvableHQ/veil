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
  type AleoMintMode,
  type EvmBridgeExecutor,
} from '@provablehq/veil-aleo-bridges'

const ROUTE_ID = 'xreserve:ethereum/usdc->aleo/usdcx'
const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const DEFAULT_ATTESTATION_POLL_INTERVAL_MS = 10_000
const DEFAULT_ATTESTATION_TIMEOUT_MS = 30 * 60_000

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

function millisecondsFromEnvironment(name: string, defaultValue: number, minimum: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return defaultValue
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`)
  }
  return value
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

async function main(): Promise<void> {
  const rpcUrl = requiredEnvironmentVariable('ETHEREUM_RPC_URL')
  const recipient = requiredEnvironmentVariable('ALEO_RECIPIENT')
  const amount = requiredEnvironmentVariable('USDC_AMOUNT')
  const mintMode = mintModeFromEnvironment()
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
  })
  const quote = await bridge.quoteEvmXReserveTransfer({ plan })

  console.log('Read-only xReserve preflight')
  console.table({
    route: quote.routeId,
    sender,
    recipient,
    mintMode,
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
    console.log('Circle attestation and automatic Aleo public/record minting run independently of this monitor.')
    console.log('Monitoring:', attestationUrl)

    while (true) {
      try {
        const attestation = await bridge.getXReserveAttestation({
          routeId: plan.route.id,
          messageHash: messageHash as Hash,
        })
        if (attestation.status === 'complete') {
          console.log('Circle attestation status: complete')
          if (mintMode === 'private') {
            console.log('User action required: submit the Aleo shielded_usdcx_wrapper.aleo/private_mint transaction.')
          } else {
            console.log(`The Aleo-side service can now complete the automatic ${mintMode} mint.`)
            console.log('This example confirms the attestation, but does not yet verify the Aleo mint transaction.')
          }
          break
        }
        console.log(`Circle attestation status: pending; checking again in ${pollIntervalMs} ms.`)
      } catch (error) {
        console.warn('Circle attestation check failed; the on-chain deposit remains valid and processing continues.')
        console.warn(error instanceof Error ? error.message : error)
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
