import {
  concat, decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeFunctionData,
  isAddress, isHash, pad, parseAbi, slice, stringToHex, toHex, zeroAddress,
  type Address, type Hash, type Hex,
} from 'viem'
import { createBridgeCheckpoint } from '../../actions/createBridgeCheckpoint.js'
import type { EvmClient, EvmReceipt } from '../../connections/evm.js'
import { requireEvmClient, requireEvmClientWithWallet, type BridgeChainClients } from '../../connections/resolve.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { CompleteParameters, ExecuteParameters, GetStatusParameters } from '../../types/actions.js'
import type { EvmCctpTransferExecution, EvmCctpTransferQuote } from '../../types/cctp.js'
import type { XReserveHttpTransport } from '../../types/xreserve.js'
import type { BridgeCheckpoint, BridgePlan, BridgeReceipt, BridgeRegistry } from '../../types/protocol.js'
import { formatDecimalAmount, parseDecimalAmount } from '../../utils/units.js'

const TOKEN = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
])
const MESSENGER = parseAbi([
  'function depositForBurn(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold)',
  'function depositForBurnWithHook(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData)',
])
const TRANSMITTER = parseAbi([
  'function usedNonces(bytes32 nonce) view returns (uint256)',
  'function receiveMessage(bytes message,bytes attestation) returns (bool)',
  'event MessageSent(bytes message)',
  'event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)',
])
// Circle's transfer tutorial and successful Ethereum-to-Arc mainnet burns use v0.
const FORWARD_HOOK = concat([stringToHex('cctp-forward', { size: 24 }), toHex(0, { size: 4 }), toHex(0, { size: 4 })])
// Preserve recovery of already-submitted v1 burns; source/attestation equality
// below prevents changing a hook after the irreversible source transaction.
const COMPOSABLE_FORWARD_HOOK = concat([stringToHex('cctp-forward', { size: 24 }), toHex(1, { size: 4 }), toHex(0, { size: 4 })])
const ZERO32 = pad(zeroAddress, { size: 32 })
type Metadata = {
  sourceChainId: number; destinationChainId: number; sourceDomain: number; destinationDomain: number
  tokenMessenger: Address; messageTransmitter: Address; attestationBaseUrl: string
  sourceToken: Address; destinationToken: Address
}

function same(a: string | undefined, b: string | undefined) { return a?.toLowerCase() === b?.toLowerCase() }
function fail(message: string): never { throw new BridgeError(message) }
function address(value: unknown, field: string): Address {
  if (typeof value !== 'string' || !isAddress(value) || same(value, zeroAddress)) fail(`Invalid CCTP ${field}`)
  return value
}
function uint(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) fail(`Invalid CCTP ${field}`)
  return value
}
function metadata(registry: BridgeRegistry, plan: BridgePlan): Metadata {
  const route = registry.routes.find(r => r.id === plan.route.id)
  if (plan.protocol !== 'cctp' || route?.protocol !== 'cctp' || route.availability !== 'active'
    || plan.registryVersion !== registry.version || route.sourceAssetId !== plan.sourceAsset.id
    || route.destinationAssetId !== plan.destinationAsset.id) fail('CCTP plan does not match an active registry route')
  const source = registry.assets.find(a => a.id === route.sourceAssetId)
  const destination = registry.assets.find(a => a.id === route.destinationAssetId)
  if (!source || !destination || source.decimals !== 6 || destination.decimals !== 6
    || source.chainId !== plan.sourceAsset.chainId || destination.chainId !== plan.destinationAsset.chainId
    || source.locator?.kind !== 'evm-contract' || destination.locator?.kind !== 'evm-contract') fail('CCTP requires canonical six-decimal EVM USDC assets')
  address(plan.recipient, 'recipient')
  if (plan.sender) address(plan.sender, 'sender')
  const amount = parseDecimalAmount(plan.amountIn, 6)
  if (amount <= 0n || amount >= 2n ** 256n) fail('CCTP amount must be a positive uint256')
  if (plan.cctp?.speed !== undefined && !['fast', 'standard'].includes(plan.cctp.speed)) fail('Invalid CCTP speed')
  if (plan.cctp?.forwarding !== undefined && typeof plan.cctp.forwarding !== 'boolean') fail('Invalid CCTP forwarding option')
  if (plan.cctp?.maxFee !== undefined && parseDecimalAmount(plan.cctp.maxFee, 6) >= amount) fail('CCTP maxFee must be less than the burn amount')
  const m = route.metadata ?? {}
  const url = m.attestationBaseUrl
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) fail('Invalid CCTP attestationBaseUrl')
  return {
    sourceChainId: uint(m.sourceChainId, 'sourceChainId'), destinationChainId: uint(m.destinationChainId, 'destinationChainId'),
    sourceDomain: uint(m.sourceDomain, 'sourceDomain'), destinationDomain: uint(m.destinationDomain, 'destinationDomain'),
    tokenMessenger: address(m.tokenMessenger, 'tokenMessenger'), messageTransmitter: address(m.messageTransmitter, 'messageTransmitter'),
    attestationBaseUrl: url.replace(/\/$/, ''), sourceToken: address(source.locator.value, 'source token'),
    destinationToken: address(destination.locator.value, 'destination token'),
  }
}
async function chain(client: EvmClient, expected: number) {
  if (await client.publicClient.getChainId() !== expected) fail(`CCTP transport must use EVM chain ${expected}`)
}
async function json(fetch: XReserveHttpTransport, url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, signal ? { signal } : undefined)
  if (response.status === 404) return null
  if (!response.ok) fail(`Circle CCTP API returned HTTP ${response.status}`)
  return response.json()
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function atomic(value: unknown, name: string): bigint {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value))
    || (typeof value === 'number' && !Number.isSafeInteger(value))) fail(`Invalid Circle ${name}`)
  return BigInt(value)
}
function bpsFee(amount: bigint, value: unknown) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+(\.\d+)?$/.test(String(value))) fail('Invalid Circle minimumFee')
  const [whole, fraction = ''] = String(value).split('.')
  const numerator = BigInt(whole! + fraction)
  const denominator = 10n ** BigInt(fraction.length) * 10_000n
  return (amount * numerator + denominator - 1n) / denominator
}

/**
 * Reads live Circle fees and resolves a fee ceiling without requesting signatures.
 * @param registry Reviewed route and asset catalog.
 * @param clients Chain capabilities retained for the common adapter signature.
 * @param fetch HTTP transport used for Circle's fee endpoint.
 * @param params Prepared transfer; omitted options select Standard transfer with forwarding.
 * @returns Quote whose plan carries the approved maximum fee in decimal USDC.
 * @throws BridgeError When metadata, fees, or the caller's ceiling are invalid.
 * @example const priced = await quote(registry, clients, fetch, { plan })
 */
export async function quote(registry: BridgeRegistry, clients: BridgeChainClients, fetch: XReserveHttpTransport, params: { plan: BridgePlan }): Promise<{ kind: 'evm-cctp'; plan: BridgePlan } & EvmCctpTransferQuote> {
  const m = metadata(registry, params.plan)
  void clients
  const speed = params.plan.cctp?.speed ?? 'standard'
  const forwarding = params.plan.cctp?.forwarding ?? true
  const minFinalityThreshold = speed === 'fast' ? 1000 : 2000
  const response = await json(fetch, `${m.attestationBaseUrl}/v2/burn/USDC/fees/${m.sourceDomain}/${m.destinationDomain}${forwarding ? '?forward=true' : ''}`)
  if (!Array.isArray(response)) fail('Circle returned invalid CCTP fees')
  const fee = response.map(record).find(f => f.finalityThreshold === minFinalityThreshold)
  if (!fee) fail('Circle does not quote the requested CCTP finality')
  const amountAtomic = parseDecimalAmount(params.plan.amountIn, 6)
  const protocolFeeAtomic = bpsFee(amountAtomic, fee.minimumFee)
  const forwardingFeeAtomic = forwarding ? atomic(record(fee.forwardFee).medium ?? record(fee.forwardFee).med, 'forwarding fee') : 0n
  const required = protocolFeeAtomic + forwardingFeeAtomic
  const maxFeeAtomic = params.plan.cctp?.maxFee === undefined ? required : parseDecimalAmount(params.plan.cctp.maxFee, 6)
  if (required > maxFeeAtomic) fail('Live CCTP fees exceed the approved maxFee; request a new quote')
  if (maxFeeAtomic >= amountAtomic) fail('CCTP fees must be less than the burn amount')
  // Forwarding spends the approved gas budget; surplus may become a priority
  // fee rather than a refund. Do not promise that headroom to the recipient.
  const amountOutAtomic = amountAtomic - (forwarding ? maxFeeAtomic : required)
  const plan: BridgePlan = {
    ...params.plan, cctp: { speed, forwarding, maxFee: formatDecimalAmount(maxFeeAtomic, 6) },
    amountOut: formatDecimalAmount(amountOutAtomic, 6),
    fees: [
      ...params.plan.fees.filter(f => f.kind === 'network'),
      { kind: 'protocol', chainId: params.plan.destinationAsset.chainId, assetId: params.plan.destinationAsset.id, amount: formatDecimalAmount(protocolFeeAtomic, 6), estimated: true },
      ...(forwarding ? [{ kind: 'relayer' as const, chainId: params.plan.destinationAsset.chainId, assetId: params.plan.destinationAsset.id, amount: formatDecimalAmount(forwardingFeeAtomic, 6), estimated: true }] : []),
    ],
  }
  return { kind: 'evm-cctp', plan, amountAtomic, amountOutAtomic, protocolFeeAtomic, forwardingFeeAtomic, maxFeeAtomic, minFinalityThreshold, forwarding }
}

function baseReceipt(plan: BridgePlan, approvals: readonly string[], sender?: string): BridgeReceipt {
  return { id: approvals.at(-1) ?? plan.route.id, protocol: 'cctp', status: approvals.length ? 'SOURCE_APPROVAL_PENDING' : 'SOURCE_SUBMISSION_PENDING',
    protocolState: { routeId: plan.route.id, approvalTxIds: [...approvals], sourceSender: sender ?? plan.sender } }
}
function result(receipt: BridgeReceipt): { kind: 'evm-cctp' } & EvmCctpTransferExecution {
  return { kind: 'evm-cctp', transactionId: receipt.destinationTxId ?? receipt.sourceTxId ?? receipt.id, receipt }
}
async function persist(plan: BridgePlan, receipt: BridgeReceipt, callback: ExecuteParameters['onCheckpoint']) {
  await callback?.(createBridgeCheckpoint(plan, receipt))
}
function validHash(value: string): Hash { if (!isHash(value)) fail('Invalid CCTP transaction hash'); return value }
function receiptSuccess(receipt: EvmReceipt, hash: string) {
  if (!same(receipt.transactionHash, hash)) fail('CCTP RPC receipt has a different transaction hash')
  if (receipt.status !== 'success') fail(`CCTP transaction reverted: ${hash}`)
}
async function confirm(client: EvmClient, hash: Hash, params: ExecuteParameters): Promise<EvmReceipt | null> {
  const timeout = params.confirmationTimeoutMs ?? 120_000
  const interval = params.pollingIntervalMs ?? 1_000
  if (!Number.isFinite(timeout) || timeout < 0 || !Number.isFinite(interval) || interval <= 0) fail('Invalid CCTP polling duration')
  const start = Date.now()
  do {
    const receipt = await client.publicClient.getTransactionReceipt(hash)
    if (receipt) { receiptSuccess(receipt, hash); return receipt }
    if (Date.now() - start >= timeout) return null
    await new Promise(resolve => setTimeout(resolve, Math.min(interval, timeout - (Date.now() - start))))
  } while (true)
}
async function approvalsConfirmed(client: EvmClient, m: Metadata, plan: BridgePlan, receipt: BridgeReceipt): Promise<boolean> {
  const values = receipt.protocolState.approvalTxIds
  if (!Array.isArray(values) || values.some(h => typeof h !== 'string' || !isHash(h))) fail('Invalid CCTP approval checkpoint')
  const sender = plan.sender ?? receipt.protocolState.sourceSender
  if (typeof sender !== 'string' || !isAddress(sender)) fail('CCTP recovery requires the source sender')
  for (const hash of values as Hash[]) {
    const [tx, mined] = await Promise.all([client.publicClient.getTransaction(hash), client.publicClient.getTransactionReceipt(hash)])
    if (!tx || !mined) return false
    receiptSuccess(mined, hash)
    if (!same(tx.hash, hash) || !same(tx.from, sender) || !same(tx.to ?? undefined, m.sourceToken)) fail('CCTP approval does not match the source account and token')
    const decoded = decodeFunctionData({ abi: TOKEN, data: tx.input })
    if (decoded.functionName !== 'approve' || !same(decoded.args[0], m.tokenMessenger)
      || decoded.args[1] !== parseDecimalAmount(plan.amountIn, 6)) fail('CCTP approval does not match the planned allowance')
  }
  return true
}

/**
 * Approves USDC when needed and submits one CCTP burn, checkpointing every broadcast.
 * @param registry Reviewed route and asset catalog.
 * @param clients Source EVM wallet and chain read capabilities.
 * @param fetch HTTP transport used to refresh fees before approval and burning.
 * @param params Transfer, optional approval-only resumption, and durable checkpoint callback.
 * @returns Submitted transaction with resumable state; pending burns are never repeated.
 * @throws BridgeError When the signer, fee ceiling, source chain, or recovered approval is invalid.
 * @example const execution = await execute(registry, clients, fetch, { plan: priced.plan })
 */
export async function execute(registry: BridgeRegistry, clients: BridgeChainClients, fetch: XReserveHttpTransport, params: ExecuteParameters & { resume?: BridgeReceipt }): Promise<{ kind: 'evm-cctp' } & EvmCctpTransferExecution> {
  const m = metadata(registry, params.plan)
  if (params.resume?.sourceTxId) return result(await getStatus(registry, clients, fetch, { plan: params.plan, receipt: params.resume }))
  const client = requireEvmClientWithWallet(registry, clients, params.plan.sourceAsset.chainId, 'burn CCTP USDC')
  await chain(client, m.sourceChainId)
  const sender = await client.walletClient.getAddress()
  if (params.plan.sender && !same(sender, params.plan.sender)) fail('CCTP source wallet differs from the planned sender')
  if (params.resume && !same(sender, String(params.resume.protocolState.sourceSender))) fail('CCTP resumed wallet differs from the checkpoint sender')
  let priced = await quote(registry, clients, fetch, { plan: { ...params.plan, sender } })
  let state = params.resume ?? baseReceipt(priced.plan, [], sender)
  if (params.resume && !await approvalsConfirmed(client, m, priced.plan, state)) return result(state)
  const balance = decodeFunctionResult({ abi: TOKEN, functionName: 'balanceOf', data: await client.publicClient.call({ to: m.sourceToken, data: encodeFunctionData({ abi: TOKEN, functionName: 'balanceOf', args: [sender] }) }) })
  if (balance < priced.amountAtomic) fail('Insufficient source USDC balance for CCTP burn')
  if (await client.publicClient.getBalance(sender) <= 0n) fail('Source wallet requires native gas funds for CCTP approval and burn')
  const allowance = decodeFunctionResult({ abi: TOKEN, functionName: 'allowance', data: await client.publicClient.call({ to: m.sourceToken, data: encodeFunctionData({ abi: TOKEN, functionName: 'allowance', args: [sender, m.tokenMessenger] }) }) })
  const approvalTxIds = [...(state.protocolState.approvalTxIds as string[])]
  if (allowance < priced.amountAtomic) {
    const hash = validHash(await client.walletClient.sendTransaction({ chainId: m.sourceChainId, from: sender, to: m.sourceToken,
      data: encodeFunctionData({ abi: TOKEN, functionName: 'approve', args: [m.tokenMessenger, priced.amountAtomic] }) }))
    approvalTxIds.push(hash)
    state = baseReceipt(priced.plan, approvalTxIds, sender)
    await persist(priced.plan, state, params.onCheckpoint)
    if (!await confirm(client, hash, params)) return result(state)
  }
  // Reprice after a potentially long approval, preserving the original cap.
  priced = await quote(registry, clients, fetch, { plan: priced.plan })
  const args = [priced.amountAtomic, m.destinationDomain, pad(params.plan.recipient as Address, { size: 32 }), m.sourceToken, ZERO32, priced.maxFeeAtomic, priced.minFinalityThreshold] as const
  const data = priced.forwarding
    ? encodeFunctionData({ abi: MESSENGER, functionName: 'depositForBurnWithHook', args: [...args, FORWARD_HOOK] })
    : encodeFunctionData({ abi: MESSENGER, functionName: 'depositForBurn', args })
  const hash = validHash(await client.walletClient.sendTransaction({ chainId: m.sourceChainId, from: sender, to: m.tokenMessenger, data }))
  state = { ...baseReceipt(priced.plan, approvalTxIds, sender), id: hash, sourceTxId: hash, status: 'SOURCE_CONFIRMING' }
  await persist(priced.plan, state, params.onCheckpoint)
  if (!await confirm(client, hash, params)) return result(state)
  return result(await getStatus(registry, clients, fetch, { plan: priced.plan, receipt: state }))
}

function hex(value: unknown): value is Hex { return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(value) }
function field(message: Hex, offset: number, length: number): Hex { return slice(message, offset, offset + length) }
function hookData(message: Hex): Hex { return message.length === 754 ? '0x' : slice(message, 376) }
function numberField(message: Hex, offset: number, length: number) { return BigInt(field(message, offset, length)) }
function checkMessage(message: Hex, m: Metadata, plan: BridgePlan, sender: string) {
  if (message.length < 2 + 376 * 2) fail('CCTP message is truncated')
  const actualHook = hookData(message)
  const matchesHook = plan.cctp?.forwarding === false
    ? actualHook === '0x'
    : [FORWARD_HOOK, COMPOSABLE_FORWARD_HOOK].some(hook => same(actualHook, hook))
  if (numberField(message, 0, 4) !== 1n || numberField(message, 148, 4) !== 1n
    || numberField(message, 4, 4) !== BigInt(m.sourceDomain) || numberField(message, 8, 4) !== BigInt(m.destinationDomain)
    || !same(field(message, 44, 32), pad(m.tokenMessenger, { size: 32 }))
    || !same(field(message, 76, 32), pad(m.tokenMessenger, { size: 32 }))
    || field(message, 108, 32) !== ZERO32
    || numberField(message, 140, 4) !== BigInt(plan.cctp?.speed === 'fast' ? 1000 : 2000)
    || !same(field(message, 152, 32), pad(m.sourceToken, { size: 32 }))
    || !same(field(message, 184, 32), pad(plan.recipient as Address, { size: 32 }))
    || numberField(message, 216, 32) !== parseDecimalAmount(plan.amountIn, 6)
    || !same(field(message, 248, 32), pad(sender as Address, { size: 32 }))
    || (plan.cctp?.maxFee !== undefined && numberField(message, 280, 32) !== parseDecimalAmount(plan.cctp.maxFee, 6))
    || !matchesHook) fail('CCTP source message does not match the transfer intent')
  if (numberField(message, 280, 32) >= parseDecimalAmount(plan.amountIn, 6)) fail('CCTP source message has an invalid fee cap')
}
function immutableMessage(message: Hex) {
  // Iris assigns the nonce and fills finality, executed fee, and expiry offchain.
  return concat([field(message, 0, 12), field(message, 44, 100), field(message, 148, 164), hookData(message)]).toLowerCase()
}
function sourceMessage(mined: EvmReceipt, m: Metadata, plan: BridgePlan, sender: string): Hex {
  const messages: Hex[] = []
  for (const log of mined.logs) {
    if (!same(log.address, m.messageTransmitter)) continue
    try {
      const event = decodeEventLog({ abi: TRANSMITTER, eventName: 'MessageSent', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
      checkMessage(event.args.message, m, plan, sender)
      messages.push(event.args.message)
    } catch { /* Other messages from a batched transaction cannot establish this transfer. */ }
  }
  if (messages.length !== 1) fail('Source receipt must contain exactly one CCTP message matching the intent')
  return messages[0]!
}
function destinationMatches(receipt: EvmReceipt, m: Metadata, message: Hex, recipient: string): boolean {
  let received = false
  let minted = false
  for (const log of receipt.logs) {
    try {
      if (same(log.address, m.messageTransmitter)) {
        const event = decodeEventLog({ abi: TRANSMITTER, eventName: 'MessageReceived', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        if (event.args.sourceDomain === m.sourceDomain && same(event.args.nonce, field(message, 12, 32))
          && same(event.args.sender, field(message, 44, 32)) && same(event.args.messageBody, slice(message, 148))
          && BigInt(event.args.finalityThresholdExecuted) === numberField(message, 144, 4)) received = true
      }
      if (same(log.address, m.destinationToken)) {
        const event = decodeEventLog({ abi: TOKEN, eventName: 'Transfer', data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        if (same(event.args.from, zeroAddress) && same(event.args.to, recipient)
          && event.args.value === numberField(message, 216, 32) - numberField(message, 312, 32)) minted = true
      }
    } catch { /* Ignore unrelated events; both exact delivery proofs remain required. */ }
  }
  return received && minted
}

/**
 * Verifies the source burn, Circle attestation, and exact destination mint without signing.
 * @param registry Reviewed contracts and domains.
 * @param clients Source and destination read capabilities.
 * @param fetch Circle attestation HTTP transport.
 * @param params Plan and latest receipt; optional signal cancels the HTTP read.
 * @returns Verified lifecycle state; nonce consumption alone never proves delivery.
 * @throws BridgeError When transaction evidence conflicts with the transfer intent.
 * @example const receipt = await getStatus(registry, clients, fetch, { plan, receipt: execution.receipt })
 */
export async function getStatus(registry: BridgeRegistry, clients: BridgeChainClients, fetch: XReserveHttpTransport, params: GetStatusParameters): Promise<BridgeReceipt> {
  const { plan } = params
  const m = metadata(registry, plan)
  let state = params.receipt
  if (state.protocol !== 'cctp' || state.protocolState.routeId !== plan.route.id) fail('CCTP receipt belongs to a different route')
  const source = requireEvmClient(registry, clients, plan.sourceAsset.chainId)
  await chain(source, m.sourceChainId)
  if (!state.sourceTxId) {
    if (!await approvalsConfirmed(source, m, plan, state)) return { ...state, status: 'SOURCE_APPROVAL_PENDING' }
    return { ...state, status: 'SOURCE_SUBMISSION_PENDING' }
  }
  const hash = validHash(state.sourceTxId)
  const mined = await source.publicClient.getTransactionReceipt(hash)
  if (!mined) return { ...state, status: 'SOURCE_CONFIRMING' }
  if (mined.status === 'reverted') return { ...state, status: 'FAILED', protocolState: { ...state.protocolState, error: 'CCTP source burn reverted' } }
  receiptSuccess(mined, hash)
  const sender = plan.sender ?? state.protocolState.sourceSender
  if (typeof sender !== 'string' || !isAddress(sender)) fail('CCTP verification requires the source sender')
  const burned = sourceMessage(mined, m, plan, sender)
  const response = record(await json(fetch, `${m.attestationBaseUrl}/v2/messages/${m.sourceDomain}?transactionHash=${hash}`, params.signal))
  if (response.sourceTxHash !== undefined && (typeof response.sourceTxHash !== 'string' || !same(response.sourceTxHash, hash))) fail('Circle returned messages for a different source transaction')
  const messages = Array.isArray(response.messages) ? response.messages.map(record) : []
  const candidates = messages.filter(entry => hex(entry.message) && entry.message.length >= 754 && immutableMessage(entry.message) === immutableMessage(burned))
  if (candidates.length > 1) fail('Circle returned ambiguous CCTP messages')
  const entry = candidates[0]
  if (!entry || entry.status !== 'complete' || !hex(entry.attestation)) return { ...state, status: 'ATTESTATION_PENDING' }
  const message = entry.message as Hex
  checkMessage(message, m, plan, sender)
  if (field(message, 12, 32) === ZERO32 || numberField(message, 144, 4) < numberField(message, 140, 4)
    || numberField(message, 312, 32) > numberField(message, 280, 32)) fail('Invalid Circle CCTP attested nonce, finality, or fee')
  const destination = requireEvmClient(registry, clients, plan.destinationAsset.chainId)
  await chain(destination, m.destinationChainId)
  const nonce = field(message, 12, 32)
  const used = decodeFunctionResult({ abi: TRANSMITTER, functionName: 'usedNonces', data: await destination.publicClient.call({ to: m.messageTransmitter, data: encodeFunctionData({ abi: TRANSMITTER, functionName: 'usedNonces', args: [nonce] }) }) }) !== 0n
  state = { ...state, messageId: nonce, protocolState: { ...state.protocolState, message, attestation: entry.attestation, nonce, nonceUsed: used, sourceSender: sender } }
  const forwarded = typeof entry.forwardTxHash === 'string' && isHash(entry.forwardTxHash) ? entry.forwardTxHash : undefined
  const destinationHash = state.destinationTxId ?? forwarded
  let forwardingFailed = false
  if (destinationHash) {
    const delivered = await destination.publicClient.getTransactionReceipt(validHash(destinationHash))
    if (delivered?.status === 'success') {
      receiptSuccess(delivered, destinationHash)
      if (!destinationMatches(delivered, m, message, plan.recipient)) fail('CCTP destination receipt does not prove the expected USDC mint')
      if (used) return { ...state, status: 'COMPLETED', destinationTxId: destinationHash, nextAction: undefined }
      return { ...state, status: 'DESTINATION_CONFIRMING', destinationTxId: destinationHash, nextAction: undefined }
    }
    if (!delivered) return { ...state, status: 'DESTINATION_CONFIRMING', destinationTxId: destinationHash, nextAction: undefined }
    // A reverted mint did not consume the message. Permit another authorized mint.
    forwardingFailed = delivered?.status === 'reverted'
    state = { ...state, destinationTxId: undefined, protocolState: { ...state.protocolState, forwardingFailed } }
  }
  if (used || (plan.cctp?.forwarding !== false && !forwardingFailed)) return { ...state, status: 'DELIVERY_PENDING', nextAction: undefined }
  return { ...state, status: 'DESTINATION_ACTION_REQUIRED', nextAction: { kind: 'cctp-mint', chainId: plan.destinationAsset.chainId } }
}

/**
 * Reconstructs CCTP state from submitted transaction identifiers using read-only checks.
 * @param registry Reviewed catalog used to rebuild the plan.
 * @param clients Chain read capabilities; no wallet is required.
 * @param fetch Circle attestation HTTP transport.
 * @param params Checkpoint, rebuilt plan, and optional HTTP cancellation signal.
 * @returns Verified state suitable for waiting, resuming approval, or completing a mint.
 * @throws BridgeError When saved transactions do not match the reconstructed intent.
 * @example const receipt = await recover(registry, clients, fetch, { checkpoint, plan })
 */
export async function recover(registry: BridgeRegistry, clients: BridgeChainClients, fetch: XReserveHttpTransport, params: { checkpoint: BridgeCheckpoint; plan: BridgePlan; signal?: AbortSignal }): Promise<BridgeReceipt> {
  const { checkpoint, plan } = params
  metadata(registry, plan)
  if (checkpoint.route.id !== plan.route.id || checkpoint.route.registryVersion !== registry.version) fail('CCTP checkpoint registry mismatch')
  const receipt = baseReceipt(plan, checkpoint.source?.approvalTransactionIds ?? [], plan.sender)
  receipt.sourceTxId = checkpoint.source?.transactionId
  receipt.destinationTxId = checkpoint.destination?.transactionId
  receipt.id = receipt.sourceTxId ?? receipt.id
  return getStatus(registry, clients, fetch, { plan, receipt, signal: params.signal })
}

/**
 * Submits a verified CCTP attestation on the destination chain for manual delivery.
 * @param registry Reviewed destination deployment.
 * @param clients Source read capability and destination wallet capability.
 * @param fetch Circle transport used to refresh the attestation before signing.
 * @param params Transfer state and optional callback persisted immediately after broadcast.
 * @returns Destination transaction with resumable state, or an existing pending/completed result.
 * @throws BridgeError When evidence is invalid or the transfer is not ready for manual minting.
 * @example const execution = await complete(registry, clients, fetch, { plan, receipt })
 */
export async function complete(registry: BridgeRegistry, clients: BridgeChainClients, fetch: XReserveHttpTransport, params: CompleteParameters): Promise<{ kind: 'evm-cctp' } & EvmCctpTransferExecution> {
  const { plan, receipt } = params.progress ?? params
  const m = metadata(registry, plan)
  const state = await getStatus(registry, clients, fetch, { plan, receipt })
  if (state.status === 'COMPLETED' || state.status === 'DESTINATION_CONFIRMING') return result(state)
  const manualFallback = params.cctp?.manualMint === true
    && state.status === 'DELIVERY_PENDING' && state.protocolState.nonceUsed === false
  if (state.status !== 'DESTINATION_ACTION_REQUIRED' && !manualFallback) fail('CCTP transfer is not ready for manual destination minting')
  const client = requireEvmClientWithWallet(registry, clients, plan.destinationAsset.chainId, 'mint CCTP USDC')
  await chain(client, m.destinationChainId)
  if (await client.publicClient.getBalance(await client.walletClient.getAddress()) <= 0n) fail('Destination wallet requires native gas funds for CCTP mint')
  const hash = validHash(await client.walletClient.sendTransaction({ chainId: m.destinationChainId, from: await client.walletClient.getAddress(), to: m.messageTransmitter,
    data: encodeFunctionData({ abi: TRANSMITTER, functionName: 'receiveMessage', args: [state.protocolState.message as Hex, state.protocolState.attestation as Hex] }) }))
  const submitted: BridgeReceipt = { ...state, status: 'DESTINATION_CONFIRMING', destinationTxId: hash, nextAction: undefined }
  await persist(plan, submitted, params.onCheckpoint)
  return result(submitted)
}
