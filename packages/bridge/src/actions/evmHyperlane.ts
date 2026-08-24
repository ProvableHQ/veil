import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHash,
  parseAbi,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { BridgeError } from '../errors/bridgeErrors.js'
import type {
  EvmBridgeExecutor,
  EvmHyperlaneRouteMetadata,
  EvmHyperlaneTransferExecution,
  EvmHyperlaneTransferQuote,
  ExecuteEvmHyperlaneTransferParameters,
  QuoteEvmHyperlaneTransferParameters,
} from '../types/evm.js'
import type { BridgeRegistry, BridgeTransferPlan, BridgeTransferReceipt } from '../types/protocol.js'
import { parseDecimalAmount } from '../utils/units.js'

const WARP_ROUTE_ABI = parseAbi([
  'function quoteTransferRemote(uint32 destination, bytes32 recipient, uint256 amount) view returns ((address token, uint256 amount)[] quotes)',
  'function transferRemote(uint32 destination, bytes32 recipient, uint256 amount) payable returns (bytes32 messageId)',
])
const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])
const DISPATCH_ID_ABI = parseAbi(['event DispatchId(bytes32 indexed messageId)'])

type RpcTransactionReceipt = {
  status?: Hex | undefined
  logs?: readonly { data: Hex, topics: readonly Hex[] }[] | undefined
}

function isHexOfBytes(value: string, bytes: number): value is Hex {
  return new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)
}

function routeMetadata(registry: BridgeRegistry, plan: BridgeTransferPlan): EvmHyperlaneRouteMetadata {
  if (plan.protocol !== 'hyperlane' || plan.route.protocol !== 'hyperlane') {
    throw new BridgeError('Ethereum Hyperlane actions require a Hyperlane transfer plan')
  }
  if (plan.registryVersion !== registry.version) {
    throw new BridgeError(`Transfer plan uses registry ${plan.registryVersion}; expected ${registry.version}`)
  }
  const route = registry.routes.find((entry) => entry.id === plan.route.id)
  if (!route || route.protocol !== 'hyperlane') {
    throw new BridgeError(`Hyperlane route is not present in the configured registry: ${plan.route.id}`)
  }
  if (route.sourceAssetId !== plan.sourceAsset.id || route.destinationAssetId !== plan.destinationAsset.id) {
    throw new BridgeError(`Transfer plan assets do not match configured route: ${route.id}`)
  }
  if (route.availability !== 'active') {
    throw new BridgeError(`Hyperlane route is not executable: ${route.id}`)
  }
  const metadata = route.metadata
  if (!metadata) throw new BridgeError(`Hyperlane route metadata is missing: ${plan.route.id}`)

  const routerAddress = metadata.routerAddress
  const sourceChainId = metadata.sourceChainId
  const destinationDomain = metadata.destinationDomain
  const routerType = metadata.routerType
  const tokenAddress = metadata.tokenAddress
  const destinationRouter = metadata.destinationRouter
  const mailboxAddress = metadata.mailboxAddress
  const interchainGasPaymaster = metadata.interchainGasPaymaster
  const interchainSecurityModule = metadata.interchainSecurityModule
  const registryCommit = metadata.registryCommit

  if (typeof routerAddress !== 'string' || !isAddress(routerAddress)) {
    throw new BridgeError(`Hyperlane route has an invalid routerAddress: ${plan.route.id}`)
  }
  if (!Number.isInteger(sourceChainId) || typeof sourceChainId !== 'number' || sourceChainId <= 0) {
    throw new BridgeError(`Hyperlane route has an invalid sourceChainId: ${plan.route.id}`)
  }
  if (!Number.isInteger(destinationDomain) || typeof destinationDomain !== 'number' || destinationDomain < 0 || destinationDomain > 0xffff_ffff) {
    throw new BridgeError(`Hyperlane route has an invalid destinationDomain: ${plan.route.id}`)
  }
  if (routerType !== 'native' && routerType !== 'collateral') {
    throw new BridgeError(`Hyperlane route has an invalid routerType: ${plan.route.id}`)
  }
  if (routerType === 'collateral' && (typeof tokenAddress !== 'string' || !isAddress(tokenAddress))) {
    throw new BridgeError(`Collateral Hyperlane route has an invalid tokenAddress: ${plan.route.id}`)
  }
  if (typeof destinationRouter !== 'string' || destinationRouter.length === 0) {
    throw new BridgeError(`Hyperlane route has an invalid destinationRouter: ${plan.route.id}`)
  }
  if (typeof mailboxAddress !== 'string' || !isAddress(mailboxAddress)) {
    throw new BridgeError(`Hyperlane route has an invalid mailboxAddress: ${plan.route.id}`)
  }
  if (typeof interchainGasPaymaster !== 'string' || !isAddress(interchainGasPaymaster)) {
    throw new BridgeError(`Hyperlane route has an invalid interchainGasPaymaster: ${plan.route.id}`)
  }
  if (typeof interchainSecurityModule !== 'string' || !isAddress(interchainSecurityModule)) {
    throw new BridgeError(`Hyperlane route has an invalid interchainSecurityModule: ${plan.route.id}`)
  }
  if (typeof registryCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(registryCommit)) {
    throw new BridgeError(`Hyperlane route has an invalid registryCommit: ${plan.route.id}`)
  }

  return {
    routerAddress: getAddress(routerAddress),
    sourceChainId,
    destinationDomain,
    routerType,
    ...(typeof tokenAddress === 'string' && isAddress(tokenAddress) ? { tokenAddress: getAddress(tokenAddress) } : {}),
    destinationRouter,
    mailboxAddress: getAddress(mailboxAddress),
    interchainGasPaymaster: getAddress(interchainGasPaymaster),
    interchainSecurityModule: getAddress(interchainSecurityModule),
    registryCommit,
    requiresApprovalReset: metadata.requiresApprovalReset === true,
  }
}

function validateRecipient(recipientBytes32: Hex): void {
  if (!isHexOfBytes(recipientBytes32, 32)) {
    throw new BridgeError('Hyperlane recipientBytes32 must contain exactly 32 bytes')
  }
}

async function rpcCall(executor: EvmBridgeExecutor, to: Address, data: Hex): Promise<Hex> {
  const result = await executor.request({
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
  })
  if (typeof result !== 'string' || !result.startsWith('0x')) {
    throw new BridgeError('EVM executor returned an invalid eth_call result')
  }
  return result as Hex
}

async function assertChain(executor: EvmBridgeExecutor, expectedChainId: number): Promise<void> {
  const result = await executor.request({ method: 'eth_chainId' })
  if (typeof result !== 'string' || !/^0x[0-9a-f]+$/i.test(result)) {
    throw new BridgeError('EVM executor returned an invalid eth_chainId result')
  }
  const actual = Number(BigInt(result))
  if (actual !== expectedChainId) {
    throw new BridgeError(`EVM wallet is connected to chain ${actual}; expected ${expectedChainId}`)
  }
}

async function resolveAccount(executor: EvmBridgeExecutor, plan: BridgeTransferPlan): Promise<Address> {
  let account = executor.account
  if (!account) {
    const result = await executor.request({ method: 'eth_accounts' })
    if (!Array.isArray(result) || typeof result[0] !== 'string' || !isAddress(result[0])) {
      throw new BridgeError('EVM executor has no connected account')
    }
    account = getAddress(result[0])
  }
  if (!isAddress(account)) throw new BridgeError('EVM executor account is invalid')
  const normalized = getAddress(account)
  if (plan.sender && (!isAddress(plan.sender) || getAddress(plan.sender) !== normalized)) {
    throw new BridgeError(`Prepared sender ${plan.sender} does not match connected account ${normalized}`)
  }
  return normalized
}

async function sendTransaction(
  executor: EvmBridgeExecutor,
  transaction: { from: Address, to: Address, data: Hex, value?: Hex | undefined },
): Promise<Hash> {
  const result = await executor.request({ method: 'eth_sendTransaction', params: [transaction] })
  if (typeof result !== 'string' || !isHash(result)) {
    throw new BridgeError('EVM executor returned an invalid transaction hash')
  }
  return result
}

async function waitForReceipt(
  executor: EvmBridgeExecutor,
  hash: Hash,
  timeoutMs: number,
  pollingIntervalMs: number,
): Promise<RpcTransactionReceipt | undefined> {
  const deadline = Date.now() + timeoutMs
  do {
    const result = await executor.request({ method: 'eth_getTransactionReceipt', params: [hash] })
    if (result != null && typeof result === 'object') return result as RpcTransactionReceipt
    if (Date.now() >= deadline) return undefined
    await new Promise<void>((resolve) => setTimeout(resolve, pollingIntervalMs))
  } while (true)
}

function assertSuccessfulReceipt(receipt: RpcTransactionReceipt, hash: Hash): void {
  if (receipt.status === '0x0') throw new BridgeError(`EVM transaction reverted: ${hash}`)
}

function messageIdFromReceipt(receipt: RpcTransactionReceipt): Hash | undefined {
  for (const log of receipt.logs ?? []) {
    try {
      const signature = log.topics[0]
      if (!signature) continue
      const decoded = decodeEventLog({
        abi: DISPATCH_ID_ABI,
        data: log.data,
        topics: [signature, ...log.topics.slice(1)],
        strict: false,
      })
      const messageId = decoded.args.messageId
      if (decoded.eventName === 'DispatchId' && messageId && isHash(messageId)) return messageId
    } catch {
      // Other receipt logs are unrelated to the Hyperlane Mailbox dispatch.
    }
  }
  return undefined
}

/**
 * Quotes an Ethereum-to-Aleo Hyperlane Warp Route transfer.
 *
 * Calls the reviewed router's `quoteTransferRemote` through the supplied EIP-1193
 * executor. The call reads live state but does not request a signature or move funds.
 *
 * @param registry Reviewed deployment snapshot used to validate the prepared plan.
 * @param executor Connected EVM provider used for the read-only contract call.
 * @param params Prepared plan and exact 32-byte Aleo recipient encoding.
 * @returns Atomic native payment and ERC-20 allowance requirements.
 * @throws BridgeError When the route is not an active Ethereum source route, metadata is incomplete, the wallet is on the wrong chain, or the router returns an unusable quote.
 *
 * @example
 * const quote = await quoteEvmHyperlaneTransfer(registry, executor, {
 *   plan,
 *   recipientBytes32: '0x20e3629764d5338f74bee96675801b1fb29d1fc68b177668f9175708bef84311',
 * })
 */
export async function quoteEvmHyperlaneTransfer(
  registry: BridgeRegistry,
  executor: EvmBridgeExecutor,
  params: QuoteEvmHyperlaneTransferParameters,
): Promise<EvmHyperlaneTransferQuote> {
  validateRecipient(params.recipientBytes32)
  const metadata = routeMetadata(registry, params.plan)
  await assertChain(executor, metadata.sourceChainId)
  const sourceAsset = registry.assets.find((asset) => asset.id === params.plan.sourceAsset.id)!
  const amountAtomic = parseDecimalAmount(params.plan.amountIn, sourceAsset.decimals)
  const data = encodeFunctionData({
    abi: WARP_ROUTE_ABI,
    functionName: 'quoteTransferRemote',
    args: [metadata.destinationDomain, params.recipientBytes32, amountAtomic],
  })
  const encoded = await rpcCall(executor, metadata.routerAddress, data)
  const quotes = decodeFunctionResult({
    abi: WARP_ROUTE_ABI,
    functionName: 'quoteTransferRemote',
    data: encoded,
  })
  const nativeValueAtomic = quotes
    .filter((quote) => getAddress(quote.token) === zeroAddress)
    .reduce((sum, quote) => sum + quote.amount, 0n)

  if (metadata.routerType === 'native') {
    if (nativeValueAtomic < amountAtomic) {
      throw new BridgeError('Native Hyperlane quote does not cover the transfer amount')
    }
    return {
      routeId: params.plan.route.id,
      routerAddress: metadata.routerAddress,
      sourceChainId: metadata.sourceChainId,
      destinationDomain: metadata.destinationDomain,
      recipientBytes32: params.recipientBytes32,
      amountAtomic,
      nativeValueAtomic,
      nativeFeeAtomic: nativeValueAtomic - amountAtomic,
    }
  }

  const tokenAddress = metadata.tokenAddress!
  const tokenAmountAtomic = quotes
    .filter((quote) => getAddress(quote.token) === tokenAddress)
    .reduce((sum, quote) => sum + quote.amount, 0n)
  if (tokenAmountAtomic < amountAtomic) {
    throw new BridgeError('Collateral Hyperlane quote does not cover the transfer amount')
  }
  return {
    routeId: params.plan.route.id,
    routerAddress: metadata.routerAddress,
    sourceChainId: metadata.sourceChainId,
    destinationDomain: metadata.destinationDomain,
    recipientBytes32: params.recipientBytes32,
    amountAtomic,
    nativeValueAtomic,
    nativeFeeAtomic: nativeValueAtomic,
    tokenAmountAtomic,
    tokenAddress,
  }
}

function executionReceipt(
  plan: BridgeTransferPlan,
  status: BridgeTransferReceipt['status'],
  id: string,
  quote: EvmHyperlaneTransferQuote,
  approvalTxIds: Hash[],
  sourceTxId?: Hash,
  messageId?: Hash,
): BridgeTransferReceipt {
  return {
    id,
    protocol: 'hyperlane',
    status,
    ...(sourceTxId ? { sourceTxId } : {}),
    ...(messageId ? { messageId } : {}),
    protocolState: {
      routeId: plan.route.id,
      approvalTxIds,
      recipientBytes32: quote.recipientBytes32,
      destinationDomain: quote.destinationDomain,
      nativeValueAtomic: quote.nativeValueAtomic.toString(),
      amountAtomic: quote.amountAtomic.toString(),
    },
  }
}

/**
 * Approves collateral when needed and dispatches an Ethereum Hyperlane transfer.
 *
 * Requotes immediately before submission, checks the connected chain and account,
 * and waits for approval receipts before dispatch. USDT routes reset an existing
 * non-zero allowance before setting a new one. Calls can prompt the wallet and move funds.
 *
 * @param registry Reviewed deployment snapshot used to validate the prepared plan.
 * @param executor Connected EIP-1193 wallet used to read, sign, and submit transactions.
 * @param params Prepared plan, wire recipient, and optional receipt polling controls.
 * @returns Submitted transaction ids plus resumable transfer state. Receipt timeouts return a pending state and do not report failure.
 * @throws BridgeError When validation, quoting, wallet submission, or a confirmed transaction fails.
 *
 * @example
 * const execution = await executeEvmHyperlaneTransfer(registry, executor, {
 *   plan,
 *   recipientBytes32: '0x20e3629764d5338f74bee96675801b1fb29d1fc68b177668f9175708bef84311',
 * })
 */
export async function executeEvmHyperlaneTransfer(
  registry: BridgeRegistry,
  executor: EvmBridgeExecutor,
  params: ExecuteEvmHyperlaneTransferParameters,
): Promise<EvmHyperlaneTransferExecution> {
  const pollingIntervalMs = params.pollingIntervalMs ?? 1_000
  const confirmationTimeoutMs = params.confirmationTimeoutMs ?? 120_000
  if (!Number.isFinite(pollingIntervalMs) || pollingIntervalMs < 0) {
    throw new BridgeError('pollingIntervalMs must be a non-negative finite number')
  }
  if (!Number.isFinite(confirmationTimeoutMs) || confirmationTimeoutMs < 0) {
    throw new BridgeError('confirmationTimeoutMs must be a non-negative finite number')
  }

  const metadata = routeMetadata(registry, params.plan)
  const quote = await quoteEvmHyperlaneTransfer(registry, executor, params)
  const account = await resolveAccount(executor, params.plan)
  const approvalTxIds: Hash[] = []

  if (metadata.routerType === 'collateral') {
    const allowanceData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account, metadata.routerAddress],
    })
    const allowanceResult = await rpcCall(executor, metadata.tokenAddress!, allowanceData)
    const allowance = decodeFunctionResult({
      abi: ERC20_ABI,
      functionName: 'allowance',
      data: allowanceResult,
    })
    const required = quote.tokenAmountAtomic!

    const approveAndConfirm = async (amount: bigint): Promise<boolean> => {
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [metadata.routerAddress, amount],
      })
      const hash = await sendTransaction(executor, { from: account, to: metadata.tokenAddress!, data })
      approvalTxIds.push(hash)
      const receipt = await waitForReceipt(executor, hash, confirmationTimeoutMs, pollingIntervalMs)
      if (!receipt) return false
      assertSuccessfulReceipt(receipt, hash)
      return true
    }

    if (allowance < required) {
      if (allowance > 0n && metadata.requiresApprovalReset) {
        if (!await approveAndConfirm(0n)) {
          return {
            approvalTxIds,
            receipt: executionReceipt(params.plan, 'SOURCE_APPROVAL_PENDING', approvalTxIds.at(-1)!, quote, approvalTxIds),
          }
        }
      }
      if (!await approveAndConfirm(required)) {
        return {
          approvalTxIds,
          receipt: executionReceipt(params.plan, 'SOURCE_APPROVAL_PENDING', approvalTxIds.at(-1)!, quote, approvalTxIds),
        }
      }
    }
  }

  const transferData = encodeFunctionData({
    abi: WARP_ROUTE_ABI,
    functionName: 'transferRemote',
    args: [quote.destinationDomain, quote.recipientBytes32, quote.amountAtomic],
  })
  const sourceTxId = await sendTransaction(executor, {
    from: account,
    to: quote.routerAddress,
    data: transferData,
    value: `0x${quote.nativeValueAtomic.toString(16)}`,
  })
  const sourceReceipt = await waitForReceipt(
    executor,
    sourceTxId,
    confirmationTimeoutMs,
    pollingIntervalMs,
  )
  if (!sourceReceipt) {
    return {
      approvalTxIds,
      receipt: executionReceipt(params.plan, 'SOURCE_CONFIRMING', sourceTxId, quote, approvalTxIds, sourceTxId),
    }
  }
  assertSuccessfulReceipt(sourceReceipt, sourceTxId)
  const messageId = messageIdFromReceipt(sourceReceipt)
  return {
    approvalTxIds,
    receipt: executionReceipt(
      params.plan,
      'DELIVERY_PENDING',
      messageId ?? sourceTxId,
      quote,
      approvalTxIds,
      sourceTxId,
      messageId,
    ),
  }
}
