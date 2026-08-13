import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHash,
  isHex,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { EvmBridgeExecutor } from '../types/evm.js'
import type { BridgeRegistry, BridgeTransferPlan, BridgeTransferReceipt } from '../types/protocol.js'
import type {
  EvmXReserveRouteMetadata,
  EvmXReserveTransferExecution,
  EvmXReserveTransferQuote,
  ExecuteEvmXReserveTransferParameters,
  GetXReserveAttestationParameters,
  QuoteEvmXReserveTransferParameters,
  XReserveAttestationResult,
  XReserveHttpTransport,
} from '../types/xreserve.js'
import { parseDecimalAmount } from '../utils/units.js'
import {
  aleoAddressToBytes32,
  aleoProgramAddress,
  buildXReserveDepositPayload,
  buildXReserveHookData,
  calculateXReserveDepositNonce,
  calculateXReserveMessageHash,
} from '../utils/xreserve.js'

const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])
const XRESERVE_ABI = parseAbi([
  'function depositToRemote(uint256 value, uint32 remoteDomain, bytes32 remoteRecipient, address localToken, uint256 maxFee, bytes hookData)',
  'event DepositedToRemote(address indexed localToken, uint256 value, address indexed localDepositor, bytes32 indexed remoteRecipient, uint32 remoteDomain, bytes32 remoteToken, uint256 maxFee, bytes hookData)',
])

type RpcReceipt = {
  status?: Hex
  transactionHash?: Hash
  logs?: readonly { address?: Address, data: Hex, topics: readonly Hex[], logIndex?: Hex | number }[]
}

function metadata(registry: BridgeRegistry, plan: BridgeTransferPlan): EvmXReserveRouteMetadata {
  if (plan.protocol !== 'xreserve' || plan.route.protocol !== 'xreserve') throw new BridgeError('xReserve actions require an xReserve transfer plan')
  if (plan.registryVersion !== registry.version) throw new BridgeError(`Transfer plan uses registry ${plan.registryVersion}; expected ${registry.version}`)
  const route = registry.routes.find((entry) => entry.id === plan.route.id)
  if (!route || route.availability !== 'active') throw new BridgeError(`xReserve route is not executable: ${plan.route.id}`)
  if (route.sourceAssetId !== plan.sourceAsset.id || route.destinationAssetId !== plan.destinationAsset.id) throw new BridgeError(`Transfer plan assets do not match configured route: ${route.id}`)
  const sourceChain = registry.chains.find((chain) => chain.id === plan.sourceAsset.chainId)
  if (sourceChain?.family !== 'evm' || plan.destinationAsset.chainId !== (route.environment === 'mainnet' ? 'aleo' : 'aleo-testnet')) {
    throw new BridgeError('This action supports Ethereum-to-Aleo xReserve deposits only')
  }
  const raw = route.metadata ?? {}
  const xReserveContract = raw.xReserveContract
  const sourceChainId = raw.sourceChainId
  const sourceDomain = raw.sourceDomain
  const remoteDomain = raw.remoteDomain
  const remoteTokenBytes32 = raw.remoteTokenBytes32
  const minimumAmountAtomic = raw.minimumAmountAtomic
  const maxFeeAtomic = raw.maxFeeAtomic
  const bridgeProgram = raw.bridgeProgram
  const wrapperProgram = raw.wrapperProgram
  const attestationBaseUrl = raw.attestationBaseUrl
  if (typeof xReserveContract !== 'string' || !isAddress(xReserveContract)) throw new BridgeError(`xReserve contract is invalid: ${route.id}`)
  if (typeof sourceChainId !== 'number' || !Number.isSafeInteger(sourceChainId) || sourceChainId <= 0) throw new BridgeError(`xReserve sourceChainId is invalid: ${route.id}`)
  if (typeof sourceDomain !== 'number' || !Number.isInteger(sourceDomain) || sourceDomain < 0) throw new BridgeError(`xReserve sourceDomain is invalid: ${route.id}`)
  if (typeof remoteDomain !== 'number' || !Number.isInteger(remoteDomain) || remoteDomain < 0) throw new BridgeError(`xReserve remoteDomain is invalid: ${route.id}`)
  if (typeof remoteTokenBytes32 !== 'string' || !/^0x[0-9a-f]{64}$/i.test(remoteTokenBytes32)) throw new BridgeError(`xReserve remote token is invalid: ${route.id}`)
  if (typeof minimumAmountAtomic !== 'string' || !/^\d+$/.test(minimumAmountAtomic)) throw new BridgeError(`xReserve minimum amount is invalid: ${route.id}`)
  if (typeof maxFeeAtomic !== 'string' || !/^\d+$/.test(maxFeeAtomic)) throw new BridgeError(`xReserve max fee is invalid: ${route.id}`)
  if (typeof bridgeProgram !== 'string' || !bridgeProgram.endsWith('.aleo')) throw new BridgeError(`xReserve bridge program is invalid: ${route.id}`)
  if (typeof wrapperProgram !== 'string' || !wrapperProgram.endsWith('.aleo')) throw new BridgeError(`xReserve wrapper program is invalid: ${route.id}`)
  if (typeof attestationBaseUrl !== 'string' || !attestationBaseUrl.startsWith('https://')) throw new BridgeError(`xReserve attestation URL is invalid: ${route.id}`)
  return { xReserveContract: getAddress(xReserveContract), sourceChainId, sourceDomain, remoteDomain, remoteTokenBytes32: remoteTokenBytes32 as Hex, minimumAmountAtomic: BigInt(minimumAmountAtomic), maxFeeAtomic: BigInt(maxFeeAtomic), bridgeProgram, wrapperProgram, attestationBaseUrl }
}

async function rpc(executor: EvmBridgeExecutor, method: string, params?: readonly unknown[]): Promise<unknown> {
  return executor.request({ method, ...(params ? { params } : {}) })
}

async function assertChain(executor: EvmBridgeExecutor, expected: number): Promise<void> {
  const chain = await rpc(executor, 'eth_chainId')
  if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain)) throw new BridgeError('EVM executor returned an invalid chain id')
  if (Number(BigInt(chain)) !== expected) throw new BridgeError(`EVM wallet is connected to chain ${Number(BigInt(chain))}; expected ${expected}`)
}

async function account(executor: EvmBridgeExecutor, plan: BridgeTransferPlan): Promise<Address> {
  const value = executor.account ?? (await rpc(executor, 'eth_accounts') as unknown[] | undefined)?.[0]
  if (typeof value !== 'string' || !isAddress(value)) throw new BridgeError('EVM executor has no connected account')
  const resolved = getAddress(value)
  if (plan.sender && (!isAddress(plan.sender) || getAddress(plan.sender) !== resolved)) throw new BridgeError(`Prepared sender ${plan.sender} does not match connected account ${resolved}`)
  return resolved
}

async function callUint(executor: EvmBridgeExecutor, to: Address, data: Hex, functionName: 'balanceOf' | 'allowance'): Promise<bigint> {
  const result = await rpc(executor, 'eth_call', [{ to, data }, 'latest'])
  if (typeof result !== 'string' || !isHex(result)) throw new BridgeError('EVM executor returned an invalid contract result')
  return decodeFunctionResult({ abi: ERC20_ABI, functionName, data: result })
}

async function send(executor: EvmBridgeExecutor, transaction: { from: Address, to: Address, data: Hex }): Promise<Hash> {
  const hash = await rpc(executor, 'eth_sendTransaction', [transaction])
  if (typeof hash !== 'string' || !isHash(hash)) throw new BridgeError('EVM executor returned an invalid transaction hash')
  return hash
}

async function wait(executor: EvmBridgeExecutor, hash: Hash, timeout: number, interval: number): Promise<RpcReceipt | undefined> {
  const deadline = Date.now() + timeout
  do {
    const result = await rpc(executor, 'eth_getTransactionReceipt', [hash])
    if (result && typeof result === 'object') return result as RpcReceipt
    if (Date.now() >= deadline) return undefined
    await new Promise<void>((resolve) => setTimeout(resolve, interval))
  } while (true)
}

function successful(receipt: RpcReceipt, hash: Hash): void {
  if (receipt.status === '0x0') throw new BridgeError(`EVM transaction reverted: ${hash}`)
}

/**
 * Reads live USDC balance and xReserve allowance for a prepared deposit.
 *
 * Derives the hook and wire recipient before performing read-only EVM calls. It
 * does not request a signature or move funds.
 *
 * @param registry Reviewed deployment snapshot used to validate the plan.
 * @param executor Connected EIP-1193 provider used for contract reads.
 * @param params Prepared Ethereum-to-Aleo xReserve plan.
 * @returns Atomic deposit values, account balance, allowance, and approval requirement.
 * @throws BridgeError When metadata, wallet state, amount, balance, or recipient is invalid.
 *
 * @example
 * const quote = await quoteEvmXReserveTransfer(registry, executor, { plan })
 */
export async function quoteEvmXReserveTransfer(
  registry: BridgeRegistry,
  executor: EvmBridgeExecutor,
  params: QuoteEvmXReserveTransferParameters,
): Promise<EvmXReserveTransferQuote> {
  const route = metadata(registry, params.plan)
  await assertChain(executor, route.sourceChainId)
  const owner = await account(executor, params.plan)
  const token = params.plan.sourceAsset.locator?.value
  if (params.plan.sourceAsset.locator?.kind !== 'evm-contract' || !token || !isAddress(token)) throw new BridgeError('xReserve source token contract is missing')
  const amountAtomic = parseDecimalAmount(params.plan.amountIn, params.plan.sourceAsset.decimals)
  if (amountAtomic < route.minimumAmountAtomic) throw new BridgeError(`xReserve minimum deposit is ${route.minimumAmountAtomic} atomic units`)
  const environment = params.plan.route.environment
  const hookData = await buildXReserveHookData(params.plan.mintMode, params.plan.recipient, environment)
  const recipient = params.plan.mintMode === 'private'
    ? await aleoProgramAddress(route.wrapperProgram, environment)
    : params.plan.recipient
  const remoteRecipientBytes32 = aleoAddressToBytes32(recipient)
  const balanceData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] })
  const allowanceData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'allowance', args: [owner, route.xReserveContract] })
  const [balanceAtomic, allowanceAtomic] = await Promise.all([
    callUint(executor, getAddress(token), balanceData, 'balanceOf'),
    callUint(executor, getAddress(token), allowanceData, 'allowance'),
  ])
  if (balanceAtomic < amountAtomic) throw new BridgeError(`Insufficient ${params.plan.sourceAsset.symbol} balance`)
  return { routeId: params.plan.route.id, xReserveContract: route.xReserveContract, tokenAddress: getAddress(token), sourceChainId: route.sourceChainId, remoteDomain: route.remoteDomain, remoteRecipientBytes32, amountAtomic, maxFeeAtomic: route.maxFeeAtomic, hookData, balanceAtomic, allowanceAtomic, approvalRequired: allowanceAtomic < amountAtomic }
}

function pendingReceipt(plan: BridgeTransferPlan, status: BridgeTransferReceipt['status'], id: string, approvalTxIds: Hash[], quote: EvmXReserveTransferQuote, sourceTxId?: Hash): BridgeTransferReceipt {
  return { id, protocol: 'xreserve', status, ...(sourceTxId ? { sourceTxId } : {}), protocolState: { routeId: plan.route.id, approvalTxIds, mintMode: plan.mintMode, intendedRecipient: plan.recipient, remoteRecipientBytes32: quote.remoteRecipientBytes32, hookData: quote.hookData, amountAtomic: quote.amountAtomic.toString(), maxFeeAtomic: quote.maxFeeAtomic.toString() } }
}

/**
 * Approves USDC when needed and submits a nonpayable Circle xReserve deposit.
 *
 * Calls the wallet for each required signature, confirms the approval before
 * depositing, and derives the Circle message hash from the confirmed event.
 *
 * @param registry Reviewed deployment snapshot used to validate the plan.
 * @param executor Connected EIP-1193 wallet used to read, sign, and submit.
 * @param params Prepared plan and optional receipt polling controls.
 * @returns Submitted approval ids and resumable xReserve transfer state.
 * @throws BridgeError When validation, submission, confirmation, or event verification fails.
 *
 * @example
 * const execution = await executeEvmXReserveTransfer(registry, executor, { plan })
 */
export async function executeEvmXReserveTransfer(
  registry: BridgeRegistry,
  executor: EvmBridgeExecutor,
  params: ExecuteEvmXReserveTransferParameters,
): Promise<EvmXReserveTransferExecution> {
  const pollingIntervalMs = params.pollingIntervalMs ?? 1_000
  const confirmationTimeoutMs = params.confirmationTimeoutMs ?? 120_000
  if (!Number.isFinite(pollingIntervalMs) || pollingIntervalMs < 0 || !Number.isFinite(confirmationTimeoutMs) || confirmationTimeoutMs < 0) throw new BridgeError('Receipt polling controls must be non-negative finite numbers')
  const route = metadata(registry, params.plan)
  const quote = await quoteEvmXReserveTransfer(registry, executor, params)
  const owner = await account(executor, params.plan)
  const approvalTxIds: Hash[] = []
  if (quote.approvalRequired) {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [route.xReserveContract, quote.amountAtomic] })
    const hash = await send(executor, { from: owner, to: quote.tokenAddress, data })
    approvalTxIds.push(hash)
    const receipt = await wait(executor, hash, confirmationTimeoutMs, pollingIntervalMs)
    if (!receipt) return { approvalTxIds, receipt: pendingReceipt(params.plan, 'SOURCE_APPROVAL_PENDING', hash, approvalTxIds, quote) }
    successful(receipt, hash)
  }
  const data = encodeFunctionData({ abi: XRESERVE_ABI, functionName: 'depositToRemote', args: [quote.amountAtomic, route.remoteDomain, quote.remoteRecipientBytes32, quote.tokenAddress, route.maxFeeAtomic, quote.hookData] })
  const sourceTxId = await send(executor, { from: owner, to: route.xReserveContract, data })
  const receipt = await wait(executor, sourceTxId, confirmationTimeoutMs, pollingIntervalMs)
  if (!receipt) return { approvalTxIds, receipt: pendingReceipt(params.plan, 'SOURCE_CONFIRMING', sourceTxId, approvalTxIds, quote, sourceTxId) }
  successful(receipt, sourceTxId)
  let matched: { log: NonNullable<RpcReceipt['logs']>[number], args: {
    localToken: Address
    value: bigint
    localDepositor: Address
    remoteRecipient: Hex
    remoteDomain: number
    remoteToken: Hex
    maxFee: bigint
    hookData: Hex
  } } | undefined
  for (const log of receipt.logs ?? []) {
    if (log.address && getAddress(log.address) !== route.xReserveContract) continue
    try {
      const decoded = decodeEventLog({ abi: XRESERVE_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
      if (decoded.eventName === 'DepositedToRemote') matched = { log, args: decoded.args }
    } catch {
      // The receipt also contains ERC-20 and xReserve implementation logs.
    }
  }
  if (!matched) throw new BridgeError('Confirmed receipt does not contain a valid DepositedToRemote event')
  const { log: eventLog, args } = matched
  if (getAddress(args.localToken) !== quote.tokenAddress || getAddress(args.localDepositor) !== owner || args.value !== quote.amountAtomic || args.remoteDomain !== route.remoteDomain || args.remoteRecipient.toLowerCase() !== quote.remoteRecipientBytes32.toLowerCase() || args.remoteToken.toLowerCase() !== route.remoteTokenBytes32.toLowerCase() || args.maxFee !== route.maxFeeAtomic || args.hookData.toLowerCase() !== quote.hookData.toLowerCase()) throw new BridgeError('DepositedToRemote event does not match the prepared transfer')
  const rawIndex = eventLog.logIndex
  const logIndex = typeof rawIndex === 'string' ? Number(BigInt(rawIndex)) : rawIndex
  if (!Number.isSafeInteger(logIndex) || logIndex == null || logIndex < 0) throw new BridgeError('DepositedToRemote log index is missing or invalid')
  const nonce = calculateXReserveDepositNonce(route.sourceDomain, sourceTxId, logIndex)
  const payload = buildXReserveDepositPayload({ amount: args.value, remoteDomain: args.remoteDomain, remoteToken: args.remoteToken, remoteRecipient: args.remoteRecipient, localToken: args.localToken, depositor: args.localDepositor, maxFee: args.maxFee, nonce, hookData: args.hookData })
  const messageHash = calculateXReserveMessageHash(payload)
  return { approvalTxIds, receipt: { id: messageHash, protocol: 'xreserve', status: 'ATTESTATION_PENDING', sourceTxId, protocolState: { ...pendingReceipt(params.plan, 'ATTESTATION_PENDING', messageHash, approvalTxIds, quote, sourceTxId).protocolState, sourceDomain: route.sourceDomain, remoteDomain: route.remoteDomain, depositLogIndex: logIndex, nonce, payload, messageHash, bridgeProgram: route.bridgeProgram, wrapperProgram: route.wrapperProgram } } }
}

/**
 * Fetches and validates one Circle attestation, treating HTTP 404 as pending.
 *
 * Performs one request through the injected transport. Completed responses are
 * checked against the requested message hash before being returned.
 *
 * @param registry Reviewed snapshot supplying the Circle endpoint.
 * @param transport Fetch-compatible HTTP capability supplied by the application.
 * @param params Route, message hash, and optional cancellation signal.
 * @returns Pending state or the verified payload and Circle signature.
 * @throws BridgeError For invalid routes, HTTP failures other than 404, or malformed responses.
 *
 * @example
 * const result = await getXReserveAttestation(registry, fetchTransport, { routeId, messageHash })
 */
export async function getXReserveAttestation(
  registry: BridgeRegistry,
  transport: XReserveHttpTransport,
  params: GetXReserveAttestationParameters,
): Promise<XReserveAttestationResult> {
  const route = registry.routes.find((entry) => entry.id === params.routeId)
  if (!route) throw new BridgeError(`Unknown bridge route: ${params.routeId}`)
  if (route.protocol !== 'xreserve' || route.availability !== 'active') throw new BridgeError(`xReserve route is not executable: ${params.routeId}`)
  const attestationBaseUrl = route.metadata?.attestationBaseUrl
  if (typeof attestationBaseUrl !== 'string' || !attestationBaseUrl.startsWith('https://')) throw new BridgeError(`xReserve attestation URL is invalid: ${params.routeId}`)
  const response = await transport(`${attestationBaseUrl}/${params.messageHash}`, params.signal ? { signal: params.signal } : undefined)
  if (response.status === 404) return { status: 'pending', messageHash: params.messageHash }
  if (!response.ok) throw new BridgeError(`Circle attester request failed with HTTP ${response.status}`)
  const body = await response.json() as { attestation?: { payload?: unknown, messageHash?: unknown, attestation?: unknown } }
  const value = body.attestation
  if (!value || typeof value.payload !== 'string' || !isHex(value.payload) || typeof value.attestation !== 'string' || !isHex(value.attestation) || value.messageHash !== params.messageHash) throw new BridgeError('Circle attester returned an invalid response')
  if (calculateXReserveMessageHash(value.payload) !== params.messageHash) throw new BridgeError('Circle attestation payload does not match the requested message hash')
  return { status: 'complete', messageHash: params.messageHash, payload: value.payload, attestation: value.attestation }
}
