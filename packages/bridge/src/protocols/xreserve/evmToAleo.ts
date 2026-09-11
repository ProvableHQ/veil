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
import type { BridgeCheckpoint, BridgeRegistry, BridgePlan, BridgeReceipt } from '../../types/protocol.js'
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
  // Resolve contracts, domains, limits, and provider endpoints from the current
  // reviewed registry. A serialized plan identifies a route but is not trusted
  // as a source of deployment addresses after an application restart.
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

async function assertChain(client: EvmClient, expected: number): Promise<void> {
  const chain = await client.publicClient.getChainId()
  if (chain !== expected) throw new BridgeError(`EVM client is connected to chain ${chain}; expected ${expected}`)
}

async function observedAccount(client: EvmClient, plan: BridgePlan, receipt?: BridgeReceipt): Promise<Address> {
  // Recovery can run with network access alone. Prefer the sender committed to
  // the receipt or plan so checking a past transfer never prompts a wallet.
  const saved = receipt?.protocolState.sourceSender
  const candidate = typeof saved === 'string' ? saved : plan.sender
  if (candidate && isAddress(candidate)) return getAddress(candidate)
  if (client.walletClient) return account(client as EvmClient & { walletClient: EvmWalletClient }, plan)
  throw new BridgeError('Read-only EVM recovery requires the prepared sender address')
}

async function account(client: EvmClient & { walletClient: EvmWalletClient }, plan: BridgePlan): Promise<Address> {
  const value = await client.walletClient.getAddress()
  if (typeof value !== 'string' || !isAddress(value)) throw new BridgeError('EVM wallet client has no connected account')
  const resolved = getAddress(value)
  if (plan.sender && (!isAddress(plan.sender) || getAddress(plan.sender) !== resolved)) throw new BridgeError(`Prepared sender ${plan.sender} does not match connected account ${resolved}`)
  return resolved
}

/** Reads one unsigned integer from the USDC contract and rejects malformed RPC data before it can influence authorization. */
async function callUint(client: EvmClient & { walletClient: EvmWalletClient }, to: Address, data: Hex, functionName: 'balanceOf' | 'allowance'): Promise<bigint> {
  const result = await client.publicClient.call({ to, data })
  if (typeof result !== 'string' || !isHex(result)) throw new BridgeError('EVM public client returned an invalid contract result')
  return decodeFunctionResult({ abi: ERC20_ABI, functionName, data: result })
}

/** Submits one EVM transaction after binding the requested chain and sender to the connected wallet. */
async function send(client: EvmClient & { walletClient: EvmWalletClient }, chainId: number, transaction: { from: Address, to: Address, data: Hex }): Promise<Hash> {
  const hash = await client.walletClient.sendTransaction({ chainId, ...transaction })
  if (typeof hash !== 'string' || !isHash(hash)) throw new BridgeError('EVM wallet client returned an invalid transaction hash')
  return hash
}

/** Polls an already-submitted EVM transaction. A timeout remains unknown because the transaction may still land. */
async function wait(client: EvmClient & { walletClient: EvmWalletClient }, hash: Hash, timeout: number, interval: number): Promise<EvmReceipt | undefined> {
  const deadline = Date.now() + timeout
  do {
    const result = await client.publicClient.getTransactionReceipt(hash)
    if (result && typeof result === 'object') return result
    if (Date.now() >= deadline) return undefined
    await new Promise<void>((resolve) => setTimeout(resolve, interval))
  } while (true)
}

/** Turns a confirmed EVM revert into a terminal bridge error while accepting any successful receipt representation. */
function successful(receipt: EvmReceipt, hash: Hash): void {
  if (receipt.status === 'reverted') throw new BridgeError(`EVM transaction reverted: ${hash}`)
}

/**
 * Calculates the USDC and approval required for an Ethereum-to-Aleo xReserve deposit.
 *
 * The result includes the connected account's balance, current xReserve
 * allowance, maximum provider fee, and the Aleo delivery instruction committed
 * by the deposit. It reads Ethereum but does not request a signature or move funds.
 *
 * @param registry Supported assets and reviewed xReserve deployments.
 * @param client Ethereum network access and the account whose balance and allowance are checked.
 * @param params Route, amount, Aleo recipient, privacy preference, and private mint secret when applicable.
 * @returns Deposit amount, maximum provider fee, balance, allowance, delivery instruction, and whether approval is required.
 * @throws BridgeError When the route is unavailable, the client uses the wrong chain or account, funds are insufficient, or the Aleo recipient is invalid.
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
  // Hook data tells the Aleo side whether Circle may mint publicly on arrival
  // or must wait for the recipient to reveal a secret and authorize private_mint.
  const hookData = await buildXReserveHookData(
    params.plan.mintMode,
    params.plan.recipient,
    environment,
    params.privateMintSecretNonce ?? '0scalar',
  )
  const recipient = params.plan.mintMode === 'private'
    ? await aleoProgramAddress(route.wrapperProgram, environment)
    : params.plan.recipient
  // Private deposits target the wrapper program, which holds the attested mint
  // until the intended recipient supplies the secret. Public deposits target
  // the recipient address directly.
  const remoteRecipientBytes32 = aleoAddressToBytes32(recipient)
  const balanceData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] })
  const allowanceData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'allowance', args: [owner, route.xReserveContract] })
  // Balance and allowance describe the same account at approximately the same
  // block. Read them together to reduce quote latency without changing state.
  const [balanceAtomic, allowanceAtomic] = await Promise.all([
    callUint(client, getAddress(token), balanceData, 'balanceOf'),
    callUint(client, getAddress(token), allowanceData, 'allowance'),
  ])
  if (balanceAtomic < amountAtomic) throw new BridgeError(`Insufficient ${params.plan.sourceAsset.symbol} balance`)
  return { routeId: params.plan.route.id, xReserveContract: route.xReserveContract, tokenAddress: getAddress(token), sourceChainId: route.sourceChainId, remoteDomain: route.remoteDomain, remoteRecipientBytes32, amountAtomic, maxFeeAtomic: route.maxFeeAtomic, hookData, balanceAtomic, allowanceAtomic, approvalRequired: allowanceAtomic < amountAtomic }
}

/** Captures every value that determines an xReserve deposit so later recovery can verify rather than reconstruct the submitted call. */
function pendingReceipt(plan: BridgePlan, status: BridgeReceipt['status'], id: string, approvalTxIds: Hash[], quote: EvmXReserveTransferQuote, sourceSender: Address, sourceTxId?: Hash): BridgeReceipt {
  return { id, protocol: 'xreserve', status, ...(sourceTxId ? { sourceTxId } : {}), protocolState: { routeId: plan.route.id, approvalTxIds, sourceSender, mintMode: plan.mintMode, intendedRecipient: plan.recipient, xReserveContract: quote.xReserveContract, tokenAddress: quote.tokenAddress, sourceChainId: quote.sourceChainId, remoteDomain: quote.remoteDomain, remoteRecipientBytes32: quote.remoteRecipientBytes32, hookData: quote.hookData, amountAtomic: quote.amountAtomic.toString(), maxFeeAtomic: quote.maxFeeAtomic.toString() } }
}

/** Rebuilds the deposit arguments from saved state and binds them to the current transfer before any transaction is observed or submitted. */
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

/** Returns only well-formed approval transaction hashes from application-controlled recovery state. */
function approvalIds(receipt: BridgeReceipt): Hash[] {
  const ids = receipt.protocolState.approvalTxIds
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !isHash(id))) {
    throw new BridgeError('Checkpoint contains invalid xReserve approval transaction ids')
  }
  return ids as Hash[]
}

/** Verifies the source deposit event and derives the exact Circle attestation lookup key from its canonical fields. */
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
  // A successful transaction is not enough: verify every event field against
  // the authorized deposit before trusting it as the source of an Aleo mint.
  if (getAddress(args.localToken) !== quote.tokenAddress || getAddress(args.localDepositor) !== owner || args.value !== quote.amountAtomic || args.remoteDomain !== route.remoteDomain || args.remoteRecipient.toLowerCase() !== quote.remoteRecipientBytes32.toLowerCase() || args.remoteToken.toLowerCase() !== route.remoteTokenBytes32.toLowerCase() || args.maxFee !== route.maxFeeAtomic || args.hookData.toLowerCase() !== quote.hookData.toLowerCase()) throw new BridgeError('DepositedToRemote event does not match the prepared transfer')
  const rawIndex = eventLog.logIndex
  const logIndex = typeof rawIndex === 'string' ? Number(BigInt(rawIndex)) : rawIndex
  if (!Number.isSafeInteger(logIndex) || logIndex == null || logIndex < 0) throw new BridgeError('DepositedToRemote log index is missing or invalid')
  // xReserve identifies one deposit by source domain, transaction hash, and log
  // index. The ordered payload below is the message Circle signs; its hash is
  // therefore the only safe attestation lookup identifier.
  const nonce = calculateXReserveDepositNonce(route.sourceDomain, sourceTxId, logIndex)
  const payload = buildXReserveDepositPayload({ amount: args.value, remoteDomain: args.remoteDomain, remoteToken: args.remoteToken, remoteRecipient: args.remoteRecipient, localToken: args.localToken, depositor: args.localDepositor, maxFee: args.maxFee, nonce, hookData: args.hookData })
  const messageHash = calculateXReserveMessageHash(payload)
  return { id: messageHash, protocol: 'xreserve', status: 'ATTESTATION_PENDING', sourceTxId, protocolState: { ...pendingReceipt(plan, 'ATTESTATION_PENDING', messageHash, approvalTxIds, quote, owner, sourceTxId).protocolState, sourceDomain: route.sourceDomain, remoteDomain: route.remoteDomain, depositLogIndex: logIndex, nonce, payload, messageHash, bridgeProgram: route.bridgeProgram, wrapperProgram: route.wrapperProgram } }
}

/**
 * Checks whether one submitted xReserve deposit has committed USDC on Ethereum.
 *
 * A pending transaction leaves the state unchanged. A successful deposit is
 * verified against its event before the Circle message and attestation lookup
 * identifier are derived. No signature or submission occurs.
 *
 * @param registry Supported assets and reviewed xReserve deployments.
 * @param client Ethereum network access used to read the transaction receipt.
 * @param plan Route, assets, amount, recipient, and privacy preference for the transfer.
 * @param receipt Latest state containing the submitted deposit transaction identifier.
 * @returns Unchanged source confirmation state or state ready for Circle attestation checks.
 * @throws BridgeError When the saved state does not match the transfer, the transaction reverted, or its deposit event differs from the intended transfer.
 * @example const next = await getSourceStatus(registry, client, plan, receipt)
 */
export async function getSourceStatus(
  registry: BridgeRegistry,
  client: EvmClient,
  plan: BridgePlan,
  receipt: BridgeReceipt,
): Promise<BridgeReceipt> {
  if (receipt.status !== 'SOURCE_CONFIRMING') {
    throw new BridgeError('xReserve source status requires a source-confirming receipt')
  }
  const route = metadata(registry, plan)
  const owner = await observedAccount(client, plan, receipt)
  const transferQuote = resumeQuote(plan, receipt)
  const approvalTxIds = approvalIds(receipt)
  const sourceTxId = receipt.sourceTxId
  if (!sourceTxId || !isHash(sourceTxId)) {
    throw new BridgeError('Checkpoint is missing the xReserve source transaction id')
  }
  const sourceReceipt = await client.publicClient.getTransactionReceipt(sourceTxId)
  if (!sourceReceipt) return receipt
  return confirmedDepositReceipt(plan, route, transferQuote, owner, approvalTxIds, sourceTxId, sourceReceipt)
}

/**
 * Reconstructs an interrupted Ethereum-to-Aleo xReserve transfer from saved transaction identifiers.
 *
 * The helper checks whether the last saved USDC approval or xReserve deposit was
 * accepted. It never requests a signature or repeats a transaction. A confirmed
 * approval with no deposit means the source transfer still needs wallet
 * authorization.
 *
 * @param registry Supported assets and reviewed xReserve deployments.
 * @param client Ethereum network access used to check submitted transactions.
 * @param plan Route, assets, amount, recipient, and privacy preference reconstructed from saved information.
 * @param checkpoint Saved route, delivery instruction, and submitted transaction identifiers.
 * @returns Current source state and whether confirmation, deposit submission, or Circle attestation comes next.
 * @throws BridgeError When the saved information does not match the transfer or a submitted transaction reverted.
 * @example const receipt = await recoverSourceCheckpoint(registry, client, plan, checkpoint)
 */
export async function recoverSourceCheckpoint(
  registry: BridgeRegistry,
  client: EvmClient,
  plan: BridgePlan,
  checkpoint: BridgeCheckpoint,
): Promise<BridgeReceipt> {
  if (checkpoint.version !== 1 || checkpoint.intent.bridgeProtocol !== 'xreserve' || checkpoint.route.id !== plan.route.id) {
    throw new BridgeError('Bridge checkpoint does not match the prepared route')
  }
  const route = metadata(registry, plan)
  await assertChain(client, route.sourceChainId)
  const owner = await observedAccount(client, plan)
  const token = plan.sourceAsset.locator?.value
  if (plan.sourceAsset.locator?.kind !== 'evm-contract' || !token || !isAddress(token)) {
    throw new BridgeError('xReserve source token contract is missing')
  }
  const amountAtomic = parseDecimalAmount(plan.amountIn, plan.sourceAsset.decimals)
  const storedHookData = checkpoint.source?.hookData
  if (storedHookData !== undefined && (!isHex(storedHookData, { strict: true }) || storedHookData.length !== 132)) {
    throw new BridgeError('Bridge checkpoint contains invalid xReserve hook data')
  }
  const hookData = storedHookData ?? await buildXReserveHookData(
    plan.mintMode,
    plan.recipient,
    plan.route.environment,
    '0scalar',
  )
  const recipient = plan.mintMode === 'private'
    ? await aleoProgramAddress(route.wrapperProgram, plan.route.environment)
    : plan.recipient
  const quote: EvmXReserveTransferQuote = {
    routeId: plan.route.id,
    xReserveContract: route.xReserveContract,
    tokenAddress: getAddress(token),
    sourceChainId: route.sourceChainId,
    remoteDomain: route.remoteDomain,
    remoteRecipientBytes32: aleoAddressToBytes32(recipient),
    amountAtomic,
    maxFeeAtomic: route.maxFeeAtomic,
    hookData,
    balanceAtomic: 0n,
    allowanceAtomic: 0n,
    approvalRequired: false,
  }
  const approvals = [...(checkpoint.source?.approvalTransactionIds ?? [])]
  if (approvals.some((id) => !isHash(id))) {
    throw new BridgeError('Bridge checkpoint contains an invalid approval transaction id')
  }
  const approvalTxIds = approvals as Hash[]

  if (!checkpoint.source?.transactionId) {
    // No source transaction means the checkpoint ended after approval
    // broadcast. Observe the latest approval, then stop before the deposit so
    // recovery itself never commits USDC to xReserve.
    const approvalTxId = approvalTxIds.at(-1)
    if (!approvalTxId) throw new BridgeError('Bridge checkpoint contains no submitted transaction')
    const pending = pendingReceipt(plan, 'SOURCE_APPROVAL_PENDING', approvalTxId, approvalTxIds, quote, owner)
    const approvalReceipt = await client.publicClient.getTransactionReceipt(approvalTxId)
    if (!approvalReceipt) return pending
    successful(approvalReceipt, approvalTxId)
    return { ...pending, status: 'SOURCE_SUBMISSION_PENDING' }
  }
  if (!isHash(checkpoint.source.transactionId)) {
    throw new BridgeError('Bridge checkpoint contains an invalid source transaction id')
  }
  const pending = pendingReceipt(
    plan,
    'SOURCE_CONFIRMING',
    checkpoint.source.transactionId,
    approvalTxIds,
    quote,
    owner,
    checkpoint.source.transactionId,
  )
  // A saved source transaction is already the irreversible deposit. From this
  // point recovery only observes Ethereum and verifies the emitted message.
  return getSourceStatus(registry, client, plan, pending)
}

/**
 * Begins a USDC-to-USDCx transfer by committing USDC to xReserve on Ethereum.
 *
 * The wallet approves USDC only when the current allowance is too low, then
 * submits the deposit. Every submitted transaction can incur an Ethereum fee.
 * Once the deposit is accepted, Circle attestation and Aleo delivery happen in
 * later stages and the source transfer may no longer be reversible.
 *
 * @param registry Supported assets and reviewed xReserve deployments.
 * @param client Ethereum network and wallet access used to read, authorize, and submit.
 * @param params Route, amount, Aleo recipient, privacy preference, confirmation controls, and recovery callback.
 * @returns Submitted approval identifiers and state needed to follow source confirmation or Circle attestation.
 * @throws BridgeError When the route is unavailable, funds are insufficient, wallet authorization fails, a transaction reverts, or the deposit event differs from the intended transfer.
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
    // Ethereum already accepted and verified the deposit. Returning the saved
    // state prevents another approval or deposit while Circle is still working.
    resumeQuote(params.plan, params.resume)
    return { approvalTxIds: approvalIds(params.resume), receipt: params.resume }
  }

  if (params.resume?.status === 'SOURCE_CONFIRMING') {
    // The deposit hash is known, so confirmation reads are the only permitted
    // operation in this branch.
    transferQuote = resumeQuote(params.plan, params.resume)
    approvalTxIds = approvalIds(params.resume)
    const sourceTxId = params.resume.sourceTxId
    if (!sourceTxId || !isHash(sourceTxId)) throw new BridgeError('Checkpoint is missing the xReserve source transaction id')
    const receipt = await wait(client, sourceTxId, confirmationTimeoutMs, pollingIntervalMs)
    if (!receipt) return { approvalTxIds, receipt: params.resume }
    return { approvalTxIds, receipt: confirmedDepositReceipt(params.plan, route, transferQuote, owner, approvalTxIds, sourceTxId, receipt) }
  }

  if (params.resume?.status === 'SOURCE_SUBMISSION_PENDING') {
    const checkpointQuote = resumeQuote(params.plan, params.resume)
    approvalTxIds = approvalIds(params.resume)
    // A prior approval succeeded without a deposit. Re-read balance, allowance,
    // and hook data before asking the wallet to authorize the irreversible step.
    transferQuote = await quote(registry, client, params)
    if (transferQuote.hookData.toLowerCase() !== checkpointQuote.hookData.toLowerCase()) {
      throw new BridgeError('Private mint secret nonce does not match the checkpointed approval')
    }
  } else if (params.resume?.status === 'SOURCE_APPROVAL_PENDING') {
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
    // Approval authorizes xReserve to spend exactly this amount but does not
    // move USDC. Persist the hash immediately because it may confirm after a
    // timeout or process failure.
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [route.xReserveContract, transferQuote.amountAtomic] })
    const hash = await send(client, route.sourceChainId, { from: owner, to: transferQuote.tokenAddress, data })
    approvalTxIds.push(hash)
    const submitted = pendingReceipt(params.plan, 'SOURCE_APPROVAL_PENDING', hash, approvalTxIds, transferQuote, owner)
    await params.onSubmitted?.(submitted)
    const receipt = await wait(client, hash, confirmationTimeoutMs, pollingIntervalMs)
    if (!receipt) return { approvalTxIds, receipt: submitted }
    successful(receipt, hash)
  }
  // depositToRemote is the irreversible source boundary: xReserve takes USDC
  // custody and commits the Aleo recipient, token, fee ceiling, and hook data.
  const data = encodeFunctionData({ abi: XRESERVE_ABI, functionName: 'depositToRemote', args: [transferQuote.amountAtomic, route.remoteDomain, transferQuote.remoteRecipientBytes32, transferQuote.tokenAddress, route.maxFeeAtomic, transferQuote.hookData] })
  const sourceTxId = await send(client, route.sourceChainId, { from: owner, to: route.xReserveContract, data })
  const submitted = pendingReceipt(params.plan, 'SOURCE_CONFIRMING', sourceTxId, approvalTxIds, transferQuote, owner, sourceTxId)
  await params.onSubmitted?.(submitted)
  const receipt = await wait(client, sourceTxId, confirmationTimeoutMs, pollingIntervalMs)
  if (!receipt) return { approvalTxIds, receipt: submitted }
  return { approvalTxIds, receipt: confirmedDepositReceipt(params.plan, route, transferQuote, owner, approvalTxIds, sourceTxId, receipt) }
}

/**
 * Checks whether Circle has attested one confirmed xReserve deposit.
 *
 * A missing attestation is reported as pending rather than failed. A completed
 * response is cryptographically tied to the requested deposit hash before it is
 * returned. The helper contacts Circle once and never requests a signature or
 * moves funds.
 *
 * @param registry Supported assets and reviewed xReserve provider endpoints.
 * @param transport HTTP access supplied by the application for the Circle request.
 * @param params Route, deposit message hash, and optional cancellation signal.
 * @returns Pending state or the verified deposit payload and Circle signature.
 * @throws BridgeError When the route is unavailable, Circle cannot be reached, or its response does not match the requested deposit.
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
  // A 404 means Circle has not signed yet; other HTTP failures indicate that
  // status is unavailable rather than that the cross-chain transfer failed.
  const response = await transport(`${attestationBaseUrl}/${params.messageHash}`, params.signal ? { signal: params.signal } : undefined)
  if (response.status === 404) return { status: 'pending', messageHash: params.messageHash }
  if (!response.ok) throw new BridgeError(`Circle attester request failed with HTTP ${response.status}`)
  const body = await response.json() as { attestation?: { payload?: unknown, messageHash?: unknown, attestation?: unknown } }
  const value = body.attestation
  if (!value || typeof value.payload !== 'string' || !isHex(value.payload) || typeof value.attestation !== 'string' || !isHex(value.attestation) || typeof value.messageHash !== 'string' || !isHash(value.messageHash) || value.messageHash.toLowerCase() !== params.messageHash.toLowerCase()) throw new BridgeError('Circle attester returned an invalid response')
  // Validate both the provider's echoed hash and a locally recomputed hash so
  // a mismatched response can never authorize an Aleo mint.
  if (calculateXReserveMessageHash(value.payload) !== params.messageHash) throw new BridgeError('Circle attestation payload does not match the requested message hash')
  return { status: 'complete', messageHash: params.messageHash, payload: value.payload, attestation: value.attestation }
}

/**
 * Delivers a private USDCx record after Circle attests an Ethereum deposit.
 *
 * The private mint secret must reproduce the recipient commitment embedded in
 * the source deposit. The Aleo wallet proves, signs, and submits the mint, which
 * incurs an Aleo transaction fee. The source deposit is never repeated.
 *
 * @param registry Supported assets and reviewed xReserve deployments.
 * @param client Aleo wallet that proves, signs, and broadcasts the private mint.
 * @param params Route, recipient, confirmed deposit, Circle attestation, private mint secret, fee preference, and recovery callbacks.
 * @returns The Aleo transaction identifier and state needed to confirm private delivery.
 * @throws BridgeError When the transfer is not a private mint, the attestation or secret does not match the deposit, or wallet submission fails.
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
  const secretNonce = params.privateMintSecretNonce ?? '0scalar'
  // Recreate the commitment embedded in the Ethereum deposit. The wallet is not
  // involved unless the recipient and secret open that exact commitment.
  const expectedHookData = await buildXReserveHookData('private', plan.recipient, route.environment, secretNonce)
  const attestedHookData = `0x${attestation.payload.slice(-130)}`
  if (attestedHookData.toLowerCase() !== expectedHookData.toLowerCase()) {
    throw new BridgeError('Private mint secret nonce and recipient do not match the attested hook data')
  }

  // Circle's signed bytes are passed verbatim into the wrapper. The Aleo
  // program verifies the attestation and consumes the deposit exactly once.
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
    onProgress: async (event) => {
      await params.onProgress?.(event)
      if (event.type === 'transaction-prepared') await params.onPrepared?.(event.transaction)
    },
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
