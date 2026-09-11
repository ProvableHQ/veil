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
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { EvmClient, EvmReceipt, EvmWalletClient } from '../../connections/evm.js'
import type {
  EvmHyperlaneRouteMetadata,
  EvmHyperlaneTransferExecution,
  EvmHyperlaneTransferQuote,
  ExecuteEvmHyperlaneTransferParameters,
  QuoteEvmHyperlaneTransferParameters,
} from '../../types/evm.js'
import type { BridgeCheckpoint, BridgeRegistry, BridgePlan, BridgeReceipt } from '../../types/protocol.js'
import { parseDecimalAmount } from '../../utils/units.js'

const WARP_ROUTE_ABI = parseAbi([
  'function quoteTransferRemote(uint32 destination, bytes32 recipient, uint256 amount) view returns ((address token, uint256 amount)[] quotes)',
  'function transferRemote(uint32 destination, bytes32 recipient, uint256 amount) payable returns (bytes32 messageId)',
])
const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])
const DISPATCH_ID_ABI = parseAbi(['event DispatchId(bytes32 indexed messageId)'])

function isHexOfBytes(value: string, bytes: number): value is Hex {
  return new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)
}

function routeMetadata(registry: BridgeRegistry, plan: BridgePlan): EvmHyperlaneRouteMetadata {
  if (plan.protocol !== 'hyperlane' || plan.route.protocol !== 'hyperlane') {
    throw new BridgeError('Ethereum Hyperlane actions require a Hyperlane transfer plan')
  }
  if (plan.registryVersion !== registry.version) {
    throw new BridgeError(`Transfer plan uses registry ${plan.registryVersion}; expected ${registry.version}`)
  }
  // Resolve deployment addresses from the current reviewed registry rather
  // than trusting the copies carried by a serialized plan.
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

async function rpcCall(client: EvmClient, to: Address, data: Hex): Promise<Hex> {
  const result = await client.publicClient.call({ to, data })
  if (typeof result !== 'string' || !result.startsWith('0x')) {
    throw new BridgeError('EVM public client returned an invalid eth_call result')
  }
  return result as Hex
}

async function assertChain(client: EvmClient, expectedChainId: number): Promise<void> {
  const actual = await client.publicClient.getChainId()
  if (actual !== expectedChainId) {
    throw new BridgeError(`EVM wallet is connected to chain ${actual}; expected ${expectedChainId}`)
  }
}

async function resolveAccount(client: EvmClient & { walletClient: EvmWalletClient }, plan: BridgePlan): Promise<Address> {
  const account = await client.walletClient.getAddress()
  if (!isAddress(account)) throw new BridgeError('EVM wallet client account is invalid')
  const normalized = getAddress(account)
  // A plan can pin the account used for its balance and allowance checks. Never
  // let a later wallet switch commit funds from a different account.
  if (plan.sender && (!isAddress(plan.sender) || getAddress(plan.sender) !== normalized)) {
    throw new BridgeError(`Prepared sender ${plan.sender} does not match connected account ${normalized}`)
  }
  return normalized
}

async function sendTransaction(
  client: EvmClient & { walletClient: EvmWalletClient },
  chainId: number,
  transaction: { from: Address, to: Address, data: Hex, value?: Hex | undefined },
): Promise<Hash> {
  const result = await client.walletClient.sendTransaction({
    chainId,
    from: transaction.from,
    to: transaction.to,
    data: transaction.data,
    ...(transaction.value ? { value: BigInt(transaction.value) } : {}),
  })
  if (!isHash(result)) {
    throw new BridgeError('EVM wallet client returned an invalid transaction hash')
  }
  return result
}

async function waitForReceipt(
  client: EvmClient,
  hash: Hash,
  timeoutMs: number,
  pollingIntervalMs: number,
): Promise<EvmReceipt | undefined> {
  const deadline = Date.now() + timeoutMs
  do {
    const result = await client.publicClient.getTransactionReceipt(hash)
    if (result != null && typeof result === 'object') return result
    if (Date.now() >= deadline) return undefined
    await new Promise<void>((resolve) => setTimeout(resolve, pollingIntervalMs))
  } while (true)
}

function assertSuccessfulReceipt(receipt: EvmReceipt, hash: Hash): void {
  if (receipt.status === 'reverted') throw new BridgeError(`EVM transaction reverted: ${hash}`)
}

function messageIdFromReceipt(receipt: EvmReceipt): Hash | undefined {
  // Hyperlane emits the cross-chain message id from its Mailbox. Other logs in
  // the same receipt belong to the token, router, and gas-payment contracts.
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
 * Calculates the source funds required for an Ethereum-to-Aleo Hyperlane transfer.
 *
 * Native routes include the asset and relayer payment in `msg.value`; token
 * routes report the ERC-20 amount separately from the native relayer payment.
 * The action reads the current router without requesting a signature or moving
 * funds.
 *
 * @param registry Supported assets and reviewed Hyperlane deployments.
 * @param client Ethereum network access used to read the selected Warp Route router.
 * @param params Route, amount, and Aleo recipient encoded as the router's 32-byte destination value.
 * @returns Atomic source amount, native payment, and token amount that may require approval.
 * @throws BridgeError When the route is unavailable, the client is on the wrong chain, or the router returns values that cannot cover the transfer.
 *
 * @example
 * const result = await quote(registry, client, {
 *   plan,
 *   recipientBytes32: '0x20e3629764d5338f74bee96675801b1fb29d1fc68b177668f9175708bef84311',
 * })
 */
export async function quote(
  registry: BridgeRegistry,
  client: EvmClient,
  params: QuoteEvmHyperlaneTransferParameters,
): Promise<EvmHyperlaneTransferQuote> {
  validateRecipient(params.recipientBytes32)
  const metadata = routeMetadata(registry, params.plan)
  await assertChain(client, metadata.sourceChainId)
  const sourceAsset = registry.assets.find((asset) => asset.id === params.plan.sourceAsset.id)!
  const amountAtomic = parseDecimalAmount(params.plan.amountIn, sourceAsset.decimals)
  // Ask the deployed router for every asset it requires. Hyperlane returns a
  // list because native value and ERC-20 collateral are accounted separately.
  const data = encodeFunctionData({
    abi: WARP_ROUTE_ABI,
    functionName: 'quoteTransferRemote',
    args: [metadata.destinationDomain, params.recipientBytes32, amountAtomic],
  })
  const encoded = await rpcCall(client, metadata.routerAddress, data)
  const quotes = decodeFunctionResult({
    abi: WARP_ROUTE_ABI,
    functionName: 'quoteTransferRemote',
    data: encoded,
  })
  const nativeValueAtomic = quotes
    .filter((quote) => getAddress(quote.token) === zeroAddress)
    .reduce((sum, quote) => sum + quote.amount, 0n)

  if (metadata.routerType === 'native') {
    // On a native route, msg.value contains both the bridged asset and the
    // relayer payment. The difference is the fee visible to the caller.
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

  // On a collateral route, the ERC-20 amount is approved and transferred while
  // msg.value pays only native-denominated delivery costs.
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
  plan: BridgePlan,
  status: BridgeReceipt['status'],
  id: string,
  quote: EvmHyperlaneTransferQuote,
  approvalTxIds: Hash[],
  sourceSender: Address,
  sourceTxId?: Hash,
  messageId?: Hash,
): BridgeReceipt {
  return {
    id,
    protocol: 'hyperlane',
    status,
    ...(sourceTxId ? { sourceTxId } : {}),
    ...(messageId ? { messageId } : {}),
    protocolState: {
      routeId: plan.route.id,
      approvalTxIds: [...approvalTxIds],
      sourceSender,
      recipientBytes32: quote.recipientBytes32,
      destinationDomain: quote.destinationDomain,
      nativeValueAtomic: quote.nativeValueAtomic.toString(),
      amountAtomic: quote.amountAtomic.toString(),
    },
  }
}

function checkpointApprovalIds(receipt: BridgeReceipt): Hash[] {
  const ids = receipt.protocolState.approvalTxIds
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !isHash(id))) {
    throw new BridgeError('Hyperlane checkpoint contains invalid approval transaction ids')
  }
  return [...ids] as Hash[]
}

function validateCheckpoint(
  registry: BridgeRegistry,
  plan: BridgePlan,
  metadata: EvmHyperlaneRouteMetadata,
  recipientBytes32: Hex,
  receipt: BridgeReceipt,
): void {
  // A checkpoint is application-controlled input. Bind every value that affects
  // the dispatch before trusting its transaction identifiers during recovery.
  const state = receipt.protocolState
  const sourceAsset = registry.assets.find((asset) => asset.id === plan.sourceAsset.id)
  if (!sourceAsset) throw new BridgeError(`Hyperlane source asset is not present in the configured registry: ${plan.sourceAsset.id}`)
  const amountAtomic = parseDecimalAmount(plan.amountIn, sourceAsset.decimals).toString()
  if (receipt.protocol !== 'hyperlane'
    || state.routeId !== plan.route.id
    || state.destinationDomain !== metadata.destinationDomain
    || state.amountAtomic !== amountAtomic
    || typeof state.recipientBytes32 !== 'string'
    || state.recipientBytes32.toLowerCase() !== recipientBytes32.toLowerCase()) {
    throw new BridgeError('Hyperlane checkpoint does not match the prepared transfer')
  }
}

/**
 * Checks whether one submitted EVM Hyperlane source transaction has committed funds.
 *
 * A pending transaction leaves the state unchanged. A successful transaction
 * advances to destination delivery and records the canonical Hyperlane message
 * identifier when the receipt contains it. No signature or submission occurs.
 *
 * @param registry Supported assets and reviewed Hyperlane deployments.
 * @param client EVM network access used to read the transaction receipt.
 * @param plan Route, assets, amount, and recipient for the transfer.
 * @param recipientBytes32 Aleo recipient committed by the transaction in its 32-byte wire encoding.
 * @param receipt Latest state containing the submitted source transaction identifier.
 * @returns Unchanged source confirmation state or state ready to follow destination delivery.
 * @throws BridgeError When the saved state does not match the transfer or the source transaction reverted.
 * @example const next = await getSourceStatus(registry, client, plan, recipientBytes32, receipt)
 */
export async function getSourceStatus(
  registry: BridgeRegistry,
  client: EvmClient,
  plan: BridgePlan,
  recipientBytes32: Hex,
  receipt: BridgeReceipt,
): Promise<BridgeReceipt> {
  const metadata = routeMetadata(registry, plan)
  await assertChain(client, metadata.sourceChainId)
  validateCheckpoint(registry, plan, metadata, recipientBytes32, receipt)
  if (receipt.status !== 'SOURCE_CONFIRMING') {
    throw new BridgeError('Hyperlane source status requires a source-confirming receipt')
  }
  const sourceTxId = receipt.sourceTxId
  if (!sourceTxId || !isHash(sourceTxId)) {
    throw new BridgeError('Hyperlane checkpoint is missing the source transaction id')
  }
  const sourceReceipt = await client.publicClient.getTransactionReceipt(sourceTxId)
  if (!sourceReceipt) return receipt
  assertSuccessfulReceipt(sourceReceipt, sourceTxId)
  // Confirmation proves the source dispatch executed. The message id is the
  // preferred destination lookup key, but retaining the source hash still lets
  // an operator diagnose a missing or unparseable Mailbox log.
  const messageId = messageIdFromReceipt(sourceReceipt)
  return {
    ...receipt,
    id: messageId ?? sourceTxId,
    status: 'DELIVERY_PENDING',
    ...(messageId ? { messageId } : {}),
  }
}

/**
 * Reconstructs an interrupted EVM Hyperlane transfer from saved transaction identifiers.
 *
 * The helper checks whether the last saved token approval or source dispatch
 * was accepted. It never requests a signature or repeats a transaction. A
 * confirmed approval with no dispatch means the source transfer still needs
 * wallet authorization.
 *
 * @param registry Supported assets and reviewed Hyperlane deployments.
 * @param client EVM network access used to check submitted transactions.
 * @param plan Route, assets, amount, and recipient reconstructed from the saved information.
 * @param recipientBytes32 Aleo recipient committed by the transfer in its 32-byte wire encoding.
 * @param checkpoint Saved route and submitted transaction identifiers.
 * @returns Current source state and whether confirmation, submission, or destination delivery comes next.
 * @throws BridgeError When the saved information does not match the transfer or a submitted transaction reverted.
 * @example const receipt = await recoverSourceCheckpoint(registry, client, plan, recipient, checkpoint)
 */
export async function recoverSourceCheckpoint(
  registry: BridgeRegistry,
  client: EvmClient,
  plan: BridgePlan,
  recipientBytes32: Hex,
  checkpoint: BridgeCheckpoint,
): Promise<BridgeReceipt> {
  if (checkpoint.version !== 1 || checkpoint.intent.bridgeProtocol !== 'hyperlane' || checkpoint.route.id !== plan.route.id) {
    throw new BridgeError('Bridge checkpoint does not match the prepared route')
  }
  const metadata = routeMetadata(registry, plan)
  const sourceAsset = registry.assets.find((asset) => asset.id === plan.sourceAsset.id)
  if (!sourceAsset) throw new BridgeError(`Hyperlane source asset is not present in the configured registry: ${plan.sourceAsset.id}`)
  const approvals = [...(checkpoint.source?.approvalTransactionIds ?? [])]
  if (approvals.some((id) => !isHash(id))) throw new BridgeError('Bridge checkpoint contains an invalid approval transaction id')
  const approvalTxIds = approvals as Hash[]
  const protocolState = {
    routeId: plan.route.id,
    approvalTxIds,
    recipientBytes32,
    destinationDomain: metadata.destinationDomain,
    nativeValueAtomic: '0',
    amountAtomic: parseDecimalAmount(plan.amountIn, sourceAsset.decimals).toString(),
  }
  if (!checkpoint.source?.transactionId) {
    // With only approvals saved, inspect the latest approval. A confirmed
    // approval stops before dispatch so recovery never moves funds by itself.
    const approvalTxId = approvalTxIds.at(-1)
    if (!approvalTxId) throw new BridgeError('Bridge checkpoint contains no submitted transaction')
    const pending: BridgeReceipt = {
      id: approvalTxId,
      protocol: 'hyperlane',
      status: 'SOURCE_APPROVAL_PENDING',
      protocolState,
    }
    const approvalReceipt = await client.publicClient.getTransactionReceipt(approvalTxId)
    if (!approvalReceipt) return pending
    assertSuccessfulReceipt(approvalReceipt, approvalTxId)
    return { ...pending, status: 'SOURCE_SUBMISSION_PENDING' }
  }
  if (!isHash(checkpoint.source.transactionId)) throw new BridgeError('Bridge checkpoint contains an invalid source transaction id')
  // A saved source transaction is already the irreversible dispatch. Observe
  // it through the normal status path rather than authorizing anything again.
  return getSourceStatus(registry, client, plan, recipientBytes32, {
    id: checkpoint.source.transactionId,
    protocol: 'hyperlane',
    status: 'SOURCE_CONFIRMING',
    sourceTxId: checkpoint.source.transactionId,
    protocolState,
  })
}

/**
 * Begins an Ethereum-to-Aleo Hyperlane transfer by committing funds on Ethereum.
 *
 * A token route requests approval only when the current allowance is too low;
 * tokens such as USDT may require resetting an existing allowance to zero first.
 * The wallet then submits the source dispatch. Every submitted transaction can
 * incur a network fee, and an accepted dispatch may no longer be reversible.
 *
 * @param registry Supported assets and reviewed Hyperlane deployments.
 * @param client Ethereum network and wallet access used to read, authorize, and submit.
 * @param params Route, assets, amount, Aleo recipient, confirmation controls, and optional recovery callback.
 * @returns Submitted approval identifiers and state needed to follow source confirmation or destination delivery. A timeout remains pending rather than reporting failure.
 * @throws BridgeError When the route is unavailable, the wallet uses a different chain or account, authorization fails, or a confirmed transaction reverted.
 *
 * @example
 * const execution = await execute(registry, client, {
 *   plan,
 *   recipientBytes32: '0x20e3629764d5338f74bee96675801b1fb29d1fc68b177668f9175708bef84311',
 * })
 */
export async function execute(
  registry: BridgeRegistry,
  client: EvmClient & { walletClient: EvmWalletClient },
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
  await assertChain(client, metadata.sourceChainId)
  let approvalTxIds: Hash[] = []

  if (params.resume) {
    // Resume receipts represent already-submitted work. Each branch observes
    // the recorded transaction and only the approval-complete branch may fall
    // through to a new source dispatch.
    validateCheckpoint(registry, params.plan, metadata, params.recipientBytes32, params.resume)
    approvalTxIds = checkpointApprovalIds(params.resume)
    if (params.resume.status === 'DELIVERY_PENDING') {
      return { approvalTxIds, receipt: params.resume }
    }
    if (params.resume.status === 'SOURCE_CONFIRMING') {
      const sourceTxId = params.resume.sourceTxId
      if (!sourceTxId || !isHash(sourceTxId)) throw new BridgeError('Hyperlane checkpoint is missing the source transaction id')
      const sourceReceipt = await waitForReceipt(client, sourceTxId, confirmationTimeoutMs, pollingIntervalMs)
      if (!sourceReceipt) return { approvalTxIds, receipt: params.resume }
      assertSuccessfulReceipt(sourceReceipt, sourceTxId)
      const messageId = messageIdFromReceipt(sourceReceipt)
      return {
        approvalTxIds,
        receipt: {
          ...params.resume,
          id: messageId ?? sourceTxId,
          status: 'DELIVERY_PENDING',
          ...(messageId ? { messageId } : {}),
        },
      }
    }
    if (params.resume.status === 'SOURCE_SUBMISSION_PENDING') {
      // Recovery already observed the final approval as successful. Requote
      // current allowance and fees before dispatching the source transfer.
    } else if (params.resume.status === 'SOURCE_APPROVAL_PENDING') {
      const approvalTxId = approvalTxIds.at(-1)
      if (!approvalTxId) throw new BridgeError('Hyperlane checkpoint is missing the approval transaction id')
      const approvalReceipt = await waitForReceipt(client, approvalTxId, confirmationTimeoutMs, pollingIntervalMs)
      if (!approvalReceipt) return { approvalTxIds, receipt: params.resume }
      assertSuccessfulReceipt(approvalReceipt, approvalTxId)
    } else {
      throw new BridgeError(`Unsupported Hyperlane resume status: ${params.resume.status}`)
    }
  }

  // Quote at the last responsible moment because router fees and token
  // allowances can change between display and wallet authorization.
  const transferQuote = await quote(registry, client, params)
  const account = await resolveAccount(client, params.plan)

  if (metadata.routerType === 'collateral') {
    // The router, not Hyperlane globally, is the ERC-20 spender. Approval is a
    // separate transaction and does not yet commit funds to the bridge.
    const allowanceData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account, metadata.routerAddress],
    })
    const allowanceResult = await rpcCall(client, metadata.tokenAddress!, allowanceData)
    const allowance = decodeFunctionResult({
      abi: ERC20_ABI,
      functionName: 'allowance',
      data: allowanceResult,
    })
    const required = transferQuote.tokenAmountAtomic!

    const approveAndConfirm = async (amount: bigint): Promise<boolean> => {
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [metadata.routerAddress, amount],
      })
      const hash = await sendTransaction(client, metadata.sourceChainId, { from: account, to: metadata.tokenAddress!, data })
      approvalTxIds.push(hash)
      // Persist immediately after broadcast and before polling. A process crash
      // can then recover this exact transaction rather than submit it again.
      const checkpoint = executionReceipt(params.plan, 'SOURCE_APPROVAL_PENDING', hash, transferQuote, approvalTxIds, account)
      await params.onSubmitted?.(checkpoint)
      const receipt = await waitForReceipt(client, hash, confirmationTimeoutMs, pollingIntervalMs)
      if (!receipt) return false
      assertSuccessfulReceipt(receipt, hash)
      return true
    }

    if (allowance < required) {
      if (allowance > 0n && metadata.requiresApprovalReset) {
        // Some tokens, notably USDT, reject non-zero-to-non-zero allowance
        // changes. Confirm the zero reset before setting the required amount.
        if (!await approveAndConfirm(0n)) {
          return {
            approvalTxIds,
            receipt: executionReceipt(params.plan, 'SOURCE_APPROVAL_PENDING', approvalTxIds.at(-1)!, transferQuote, approvalTxIds, account),
          }
        }
      }
      if (!await approveAndConfirm(required)) {
        return {
          approvalTxIds,
          receipt: executionReceipt(params.plan, 'SOURCE_APPROVAL_PENDING', approvalTxIds.at(-1)!, transferQuote, approvalTxIds, account),
        }
      }
    }
  }

  // This dispatch is the irreversible source boundary: the router locks or
  // burns the source asset and emits the cross-chain message.
  const transferData = encodeFunctionData({
    abi: WARP_ROUTE_ABI,
    functionName: 'transferRemote',
    args: [transferQuote.destinationDomain, transferQuote.recipientBytes32, transferQuote.amountAtomic],
  })
  const sourceTxId = await sendTransaction(client, metadata.sourceChainId, {
    from: account,
    to: transferQuote.routerAddress,
    data: transferData,
    value: `0x${transferQuote.nativeValueAtomic.toString(16)}`,
  })
  const checkpoint = executionReceipt(params.plan, 'SOURCE_CONFIRMING', sourceTxId, transferQuote, approvalTxIds, account, sourceTxId)
  // The transaction may land even if receipt polling times out or the process
  // exits, so checkpoint the hash before any confirmation read.
  await params.onSubmitted?.(checkpoint)
  const sourceReceipt = await waitForReceipt(
    client,
    sourceTxId,
    confirmationTimeoutMs,
    pollingIntervalMs,
  )
  if (!sourceReceipt) {
    // Lack of a receipt is unknown, not failure. Return enough state for a later
    // status check to distinguish pending, success, and revert.
    return {
      approvalTxIds,
      receipt: checkpoint,
    }
  }
  assertSuccessfulReceipt(sourceReceipt, sourceTxId)
  // Destination verification is keyed by the Mailbox message id when present.
  const messageId = messageIdFromReceipt(sourceReceipt)
  return {
    approvalTxIds,
    receipt: executionReceipt(
      params.plan,
      'DELIVERY_PENDING',
      messageId ?? sourceTxId,
      transferQuote,
      approvalTxIds,
      account,
      sourceTxId,
      messageId,
    ),
  }
}
