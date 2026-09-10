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
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { EvmClient, EvmReceipt, EvmWalletClient } from '../../connections/evm.js'
import type {
  AleoWalletClient,
  ExecuteXReservePrivateMintParameters,
  XReservePrivateMintExecution,
} from '../../types/aleo.js'
import type { BridgeRegistry, BridgePlan, BridgeReceipt } from '../../types/protocol.js'
import type {
  EvmXReserveRouteMetadata,
  EvmXReserveTransferExecution,
  EvmXReserveTransferQuote,
  ExecuteEvmXReserveTransferParameters,
  GetXReserveAttestationParameters,
  QuoteEvmXReserveTransferParameters,
  XReserveAttestationResult,
  XReserveHttpTransport,
} from '../../types/xreserve.js'
import { parseDecimalAmount } from '../../utils/units.js'
import {
  aleoAddressToBytes32,
  aleoProgramAddress,
  buildXReserveDepositPayload,
  buildXReserveHookData,
  calculateXReserveDepositNonce,
  calculateXReserveMessageHash,
  xReserveHexToAleoBytes,
} from '../../utils/xreserve.js'

const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])
const XRESERVE_ABI = parseAbi([
  'function depositToRemote(uint256 value, uint32 remoteDomain, bytes32 remoteRecipient, address localToken, uint256 maxFee, bytes hookData)',
  'event DepositedToRemote(address indexed localToken, uint256 value, address indexed localDepositor, bytes32 indexed remoteRecipient, uint32 remoteDomain, bytes32 remoteToken, uint256 maxFee, bytes hookData)',
])

function metadata(registry: BridgeRegistry, plan: BridgePlan): EvmXReserveRouteMetadata {
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

async function assertChain(client: EvmClient & { walletClient: EvmWalletClient }, expected: number): Promise<void> {
  const chain = await client.publicClient.getChainId()
  if (chain !== expected) throw new BridgeError(`EVM wallet is connected to chain ${chain}; expected ${expected}`)
}

async function account(client: EvmClient & { walletClient: EvmWalletClient }, plan: BridgePlan): Promise<Address> {
  const value = await client.walletClient.getAddress()
  if (typeof value !== 'string' || !isAddress(value)) throw new BridgeError('EVM wallet client has no connected account')
  const resolved = getAddress(value)
  if (plan.sender && (!isAddress(plan.sender) || getAddress(plan.sender) !== resolved)) throw new BridgeError(`Prepared sender ${plan.sender} does not match connected account ${resolved}`)
  return resolved
}

async function callUint(client: EvmClient & { walletClient: EvmWalletClient }, to: Address, data: Hex, functionName: 'balanceOf' | 'allowance'): Promise<bigint> {
  const result = await client.publicClient.call({ to, data })
  if (typeof result !== 'string' || !isHex(result)) throw new BridgeError('EVM public client returned an invalid contract result')
  return decodeFunctionResult({ abi: ERC20_ABI, functionName, data: result })
}

async function send(client: EvmClient & { walletClient: EvmWalletClient }, chainId: number, transaction: { from: Address, to: Address, data: Hex }): Promise<Hash> {
  const hash = await client.walletClient.sendTransaction({ chainId, ...transaction })
  if (typeof hash !== 'string' || !isHash(hash)) throw new BridgeError('EVM wallet client returned an invalid transaction hash')
  return hash
}

async function wait(client: EvmClient & { walletClient: EvmWalletClient }, hash: Hash, timeout: number, interval: number): Promise<EvmReceipt | undefined> {
  const deadline = Date.now() + timeout
  do {
    const result = await client.publicClient.getTransactionReceipt(hash)
    if (result && typeof result === 'object') return result
    if (Date.now() >= deadline) return undefined
    await new Promise<void>((resolve) => setTimeout(resolve, interval))
  } while (true)
}

function successful(receipt: EvmReceipt, hash: Hash): void {
  if (receipt.status === 'reverted') throw new BridgeError(`EVM transaction reverted: ${hash}`)
}

/**
 * Reads live USDC balance and xReserve allowance for a prepared deposit.
 *
 * Derives the hook and wire recipient before performing read-only EVM calls. It
 * does not request a signature or move funds.
 *
 * @param registry Reviewed deployment snapshot used to validate the plan.
 * @param client Registry-selected EVM public and wallet capabilities.
 * @param params Prepared Ethereum-to-Aleo xReserve plan.
 * @returns Atomic deposit values, account balance, allowance, and approval requirement.
 * @throws BridgeError When metadata, wallet state, amount, balance, or recipient is invalid.
 *
 * @example
 * const result = await quote(registry, client, { plan })
 */
export async function quote(
  registry: BridgeRegistry,
  client: EvmClient & { walletClient: EvmWalletClient },
  params: QuoteEvmXReserveTransferParameters,
): Promise<EvmXReserveTransferQuote> {
  const route = metadata(registry, params.plan)
  await assertChain(client, route.sourceChainId)
  const owner = await account(client, params.plan)
  const token = params.plan.sourceAsset.locator?.value
  if (params.plan.sourceAsset.locator?.kind !== 'evm-contract' || !token || !isAddress(token)) throw new BridgeError('xReserve source token contract is missing')
  const amountAtomic = parseDecimalAmount(params.plan.amountIn, params.plan.sourceAsset.decimals)
  if (amountAtomic < route.minimumAmountAtomic) throw new BridgeError(`xReserve minimum deposit is ${route.minimumAmountAtomic} atomic units`)
  const environment = params.plan.route.environment
  const hookData = await buildXReserveHookData(
    params.plan.mintMode,
    params.plan.recipient,
    environment,
    params.plan.privateMintSecretNonce ?? '0scalar',
  )
  const recipient = params.plan.mintMode === 'private'
    ? await aleoProgramAddress(route.wrapperProgram, environment)
    : params.plan.recipient
  const remoteRecipientBytes32 = aleoAddressToBytes32(recipient)
  const balanceData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] })
  const allowanceData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'allowance', args: [owner, route.xReserveContract] })
  const [balanceAtomic, allowanceAtomic] = await Promise.all([
    callUint(client, getAddress(token), balanceData, 'balanceOf'),
    callUint(client, getAddress(token), allowanceData, 'allowance'),
  ])
  if (balanceAtomic < amountAtomic) throw new BridgeError(`Insufficient ${params.plan.sourceAsset.symbol} balance`)
  return { routeId: params.plan.route.id, xReserveContract: route.xReserveContract, tokenAddress: getAddress(token), sourceChainId: route.sourceChainId, remoteDomain: route.remoteDomain, remoteRecipientBytes32, amountAtomic, maxFeeAtomic: route.maxFeeAtomic, hookData, balanceAtomic, allowanceAtomic, approvalRequired: allowanceAtomic < amountAtomic }
}

function pendingReceipt(plan: BridgePlan, status: BridgeReceipt['status'], id: string, approvalTxIds: Hash[], quote: EvmXReserveTransferQuote, sourceTxId?: Hash): BridgeReceipt {
  return { id, protocol: 'xreserve', status, ...(sourceTxId ? { sourceTxId } : {}), protocolState: { routeId: plan.route.id, approvalTxIds, mintMode: plan.mintMode, intendedRecipient: plan.recipient, xReserveContract: quote.xReserveContract, tokenAddress: quote.tokenAddress, sourceChainId: quote.sourceChainId, remoteDomain: quote.remoteDomain, remoteRecipientBytes32: quote.remoteRecipientBytes32, hookData: quote.hookData, amountAtomic: quote.amountAtomic.toString(), maxFeeAtomic: quote.maxFeeAtomic.toString() } }
}

function resumeQuote(plan: BridgePlan, receipt: BridgeReceipt): EvmXReserveTransferQuote {
  const state = receipt.protocolState
  if (receipt.protocol !== 'xreserve' || state.routeId !== plan.route.id) {
    throw new BridgeError('Checkpoint does not match the prepared xReserve route')
  }
  if (state.mintMode !== plan.mintMode || state.intendedRecipient !== plan.recipient) {
    throw new BridgeError('Checkpoint does not match the prepared xReserve recipient')
  }
  if (typeof state.xReserveContract !== 'string' || !isAddress(state.xReserveContract)
    || typeof state.tokenAddress !== 'string' || !isAddress(state.tokenAddress)
    || typeof state.sourceChainId !== 'number' || typeof state.remoteDomain !== 'number'
    || typeof state.remoteRecipientBytes32 !== 'string' || !isHex(state.remoteRecipientBytes32)
    || typeof state.hookData !== 'string' || !isHex(state.hookData)
    || typeof state.amountAtomic !== 'string' || !/^\d+$/.test(state.amountAtomic)
    || typeof state.maxFeeAtomic !== 'string' || !/^\d+$/.test(state.maxFeeAtomic)) {
    throw new BridgeError('Checkpoint contains invalid xReserve submission state')
  }
  return {
    routeId: plan.route.id,
    xReserveContract: getAddress(state.xReserveContract),
    tokenAddress: getAddress(state.tokenAddress),
    sourceChainId: state.sourceChainId,
    remoteDomain: state.remoteDomain,
    remoteRecipientBytes32: state.remoteRecipientBytes32,
    amountAtomic: BigInt(state.amountAtomic),
    maxFeeAtomic: BigInt(state.maxFeeAtomic),
    hookData: state.hookData,
    balanceAtomic: 0n,
    allowanceAtomic: 0n,
    approvalRequired: false,
  }
}

function approvalIds(receipt: BridgeReceipt): Hash[] {
  const ids = receipt.protocolState.approvalTxIds
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !isHash(id))) {
    throw new BridgeError('Checkpoint contains invalid xReserve approval transaction ids')
  }
  return ids as Hash[]
}

function confirmedDepositReceipt(
  plan: BridgePlan,
  route: EvmXReserveRouteMetadata,
  quote: EvmXReserveTransferQuote,
  owner: Address,
  approvalTxIds: Hash[],
  sourceTxId: Hash,
  receipt: EvmReceipt,
): BridgeReceipt {
  successful(receipt, sourceTxId)
  let matched: { log: NonNullable<EvmReceipt['logs']>[number], args: {
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
  return { id: messageHash, protocol: 'xreserve', status: 'ATTESTATION_PENDING', sourceTxId, protocolState: { ...pendingReceipt(plan, 'ATTESTATION_PENDING', messageHash, approvalTxIds, quote, sourceTxId).protocolState, sourceDomain: route.sourceDomain, remoteDomain: route.remoteDomain, depositLogIndex: logIndex, nonce, payload, messageHash, bridgeProgram: route.bridgeProgram, wrapperProgram: route.wrapperProgram } }
}

/**
 * Approves USDC when needed and submits a nonpayable Circle xReserve deposit.
 *
 * Calls the wallet for each required signature, confirms the approval before
 * depositing, and derives the Circle message hash from the confirmed event.
 *
 * @param registry Reviewed deployment snapshot used to validate the plan.
 * @param client Registry-selected EVM public and wallet capabilities.
 * @param params Prepared plan and optional receipt polling controls.
 * @returns Submitted approval ids and resumable xReserve transfer state.
 * @throws BridgeError When validation, submission, confirmation, or event verification fails.
 *
 * @example
 * const execution = await execute(registry, client, { plan })
 */
export async function execute(
  registry: BridgeRegistry,
  client: EvmClient & { walletClient: EvmWalletClient },
  params: ExecuteEvmXReserveTransferParameters,
): Promise<EvmXReserveTransferExecution> {
  const pollingIntervalMs = params.pollingIntervalMs ?? 1_000
  const confirmationTimeoutMs = params.confirmationTimeoutMs ?? 120_000
  if (!Number.isFinite(pollingIntervalMs) || pollingIntervalMs < 0 || !Number.isFinite(confirmationTimeoutMs) || confirmationTimeoutMs < 0) throw new BridgeError('Receipt polling controls must be non-negative finite numbers')
  const route = metadata(registry, params.plan)
  const owner = await account(client, params.plan)
  let transferQuote: EvmXReserveTransferQuote
  let approvalTxIds: Hash[] = []

  if (params.resume?.status === 'ATTESTATION_PENDING') {
    resumeQuote(params.plan, params.resume)
    return { approvalTxIds: approvalIds(params.resume), receipt: params.resume }
  }

  if (params.resume?.status === 'SOURCE_CONFIRMING') {
    transferQuote = resumeQuote(params.plan, params.resume)
    approvalTxIds = approvalIds(params.resume)
    const sourceTxId = params.resume.sourceTxId
    if (!sourceTxId || !isHash(sourceTxId)) throw new BridgeError('Checkpoint is missing the xReserve source transaction id')
    const receipt = await wait(client, sourceTxId, confirmationTimeoutMs, pollingIntervalMs)
    if (!receipt) return { approvalTxIds, receipt: params.resume }
    return { approvalTxIds, receipt: confirmedDepositReceipt(params.plan, route, transferQuote, owner, approvalTxIds, sourceTxId, receipt) }
  }

  if (params.resume?.status === 'SOURCE_APPROVAL_PENDING') {
    resumeQuote(params.plan, params.resume)
    approvalTxIds = approvalIds(params.resume)
    const approvalTxId = params.resume.id
    if (!isHash(approvalTxId)) throw new BridgeError('Checkpoint is missing the xReserve approval transaction id')
    const receipt = await wait(client, approvalTxId, confirmationTimeoutMs, pollingIntervalMs)
    if (!receipt) return { approvalTxIds, receipt: params.resume }
    successful(receipt, approvalTxId)
    transferQuote = await quote(registry, client, params)
  } else if (params.resume) {
    throw new BridgeError(`Unsupported xReserve resume status: ${params.resume.status}`)
  } else {
    transferQuote = await quote(registry, client, params)
  }

  if (transferQuote.approvalRequired) {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [route.xReserveContract, transferQuote.amountAtomic] })
    const hash = await send(client, route.sourceChainId, { from: owner, to: transferQuote.tokenAddress, data })
    approvalTxIds.push(hash)
    const submitted = pendingReceipt(params.plan, 'SOURCE_APPROVAL_PENDING', hash, approvalTxIds, transferQuote)
    await params.onSubmitted?.(submitted)
    const receipt = await wait(client, hash, confirmationTimeoutMs, pollingIntervalMs)
    if (!receipt) return { approvalTxIds, receipt: submitted }
    successful(receipt, hash)
  }
  const data = encodeFunctionData({ abi: XRESERVE_ABI, functionName: 'depositToRemote', args: [transferQuote.amountAtomic, route.remoteDomain, transferQuote.remoteRecipientBytes32, transferQuote.tokenAddress, route.maxFeeAtomic, transferQuote.hookData] })
  const sourceTxId = await send(client, route.sourceChainId, { from: owner, to: route.xReserveContract, data })
  const submitted = pendingReceipt(params.plan, 'SOURCE_CONFIRMING', sourceTxId, approvalTxIds, transferQuote, sourceTxId)
  await params.onSubmitted?.(submitted)
  const receipt = await wait(client, sourceTxId, confirmationTimeoutMs, pollingIntervalMs)
  if (!receipt) return { approvalTxIds, receipt: submitted }
  return { approvalTxIds, receipt: confirmedDepositReceipt(params.plan, route, transferQuote, owner, approvalTxIds, sourceTxId, receipt) }
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
 * const result = await getAttestation(registry, fetchTransport, { routeId, messageHash })
 */
export async function getAttestation(
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
  if (!value || typeof value.payload !== 'string' || !isHex(value.payload) || typeof value.attestation !== 'string' || !isHex(value.attestation) || typeof value.messageHash !== 'string' || !isHash(value.messageHash) || value.messageHash.toLowerCase() !== params.messageHash.toLowerCase()) throw new BridgeError('Circle attester returned an invalid response')
  if (calculateXReserveMessageHash(value.payload) !== params.messageHash) throw new BridgeError('Circle attestation payload does not match the requested message hash')
  return { status: 'complete', messageHash: params.messageHash, payload: value.payload, attestation: value.attestation }
}

/**
 * Submits the sole user-authorized Aleo mint in an inbound xReserve flow.
 *
 * Requires a private plan and completed Circle attestation. The wallet calls
 * the wrapper's `private_mint` with the canonical payload, signature, hash,
 * secret nonce, and intended recipient.
 *
 * @param registry Reviewed deployment snapshot used to resolve the wrapper program.
 * @param client Aleo wallet client that proves, signs, and broadcasts.
 * @param params Original plan, confirmed deposit, attestation, and checkpoint hook.
 * @returns The Aleo transaction id and destination-confirming receipt.
 * @throws BridgeError When the private plan, attestation, or wallet result is invalid.
 * @example const mint = await complete(registry, client, { plan, deposit, attestation })
 */
export async function complete(
  registry: BridgeRegistry,
  client: AleoWalletClient,
  params: ExecuteXReservePrivateMintParameters,
): Promise<XReservePrivateMintExecution> {
  const { plan, deposit, attestation } = params
  if (plan.protocol !== 'xreserve' || plan.route.protocol !== 'xreserve' || plan.mintMode !== 'private') {
    throw new BridgeError('private_mint requires a private xReserve transfer plan')
  }
  if (plan.registryVersion !== registry.version) throw new BridgeError(`Transfer plan uses registry ${plan.registryVersion}; expected ${registry.version}`)
  const route = registry.routes.find((entry) => entry.id === plan.route.id)
  if (!route || route.protocol !== 'xreserve' || route.availability !== 'active') throw new BridgeError(`xReserve route is not executable: ${plan.route.id}`)
  const wrapperProgram = route.metadata?.wrapperProgram
  if (typeof wrapperProgram !== 'string' || !wrapperProgram.endsWith('.aleo')) throw new BridgeError(`xReserve wrapper program is invalid: ${plan.route.id}`)
  if (deposit.protocol !== 'xreserve' || deposit.status !== 'ATTESTATION_PENDING') throw new BridgeError('Private mint requires a confirmed xReserve deposit awaiting attestation')
  if (attestation.status !== 'complete') throw new BridgeError('Private mint requires a completed Circle attestation')

  const depositPayload = deposit.protocolState.payload
  const depositHash = deposit.protocolState.messageHash
  const intendedRecipient = deposit.protocolState.intendedRecipient
  const mintMode = deposit.protocolState.mintMode
  if (typeof depositPayload !== 'string' || !isHex(depositPayload, { strict: true })) throw new BridgeError('Deposit receipt is missing the canonical xReserve payload')
  if (typeof depositHash !== 'string' || !isHash(depositHash)) throw new BridgeError('Deposit receipt is missing the Circle message hash')
  if (typeof intendedRecipient !== 'string' || intendedRecipient !== plan.recipient || mintMode !== 'private') throw new BridgeError('Deposit receipt does not match the private mint plan')
  if (attestation.payload.toLowerCase() !== depositPayload.toLowerCase() || attestation.messageHash.toLowerCase() !== depositHash.toLowerCase()) throw new BridgeError('Circle attestation does not match the confirmed deposit')
  if (calculateXReserveMessageHash(attestation.payload) !== attestation.messageHash) throw new BridgeError('Circle attestation payload has an invalid message hash')
  const secretNonce = plan.privateMintSecretNonce ?? '0scalar'
  const expectedHookData = await buildXReserveHookData('private', plan.recipient, route.environment, secretNonce)
  const attestedHookData = `0x${attestation.payload.slice(-130)}`
  if (attestedHookData.toLowerCase() !== expectedHookData.toLowerCase()) {
    throw new BridgeError('Private mint secret nonce and recipient do not match the attested hook data')
  }

  const transactionId = await client.executeTransaction({
    program: wrapperProgram,
    function: 'private_mint',
    inputs: [
      xReserveHexToAleoBytes(attestation.payload, 305),
      xReserveHexToAleoBytes(attestation.attestation, 65),
      xReserveHexToAleoBytes(attestation.messageHash, 32),
      secretNonce,
      plan.recipient,
    ],
    privateFee: params.privateFee ?? false,
  })
  if (!transactionId) throw new BridgeError('Aleo wallet returned an empty private mint transaction id')
  const receipt: BridgeReceipt = {
    ...deposit,
    status: 'DESTINATION_CONFIRMING',
    destinationTxId: transactionId,
    protocolState: {
      ...deposit.protocolState,
      attestation: attestation.attestation,
      destinationProgram: wrapperProgram,
      destinationFunction: 'private_mint',
      secretNonce,
    },
  }
  await params.onSubmitted?.(receipt)
  return { transactionId, receipt }
}
