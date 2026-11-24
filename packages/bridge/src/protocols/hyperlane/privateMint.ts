import { classifyBroadcastError, DuplicateTransactionError, readContract, transactionStatus, type AlgorithmGrant, type Transaction, type TransactionInput } from '@provablehq/veil-core'
import { resolveTransferRoute } from '../../actions/internal/resolveTransferRoute.js'
import { requireAleoClient, requireAleoClientWithWallet, type BridgeChainClients } from '../../connections/resolve.js'
import { BridgeError, PrivateHyperlaneSubmissionError } from '../../errors/bridgeErrors.js'
import type { CompleteParameters } from '../../types/actions.js'
import type { BridgePlan, BridgeReceipt, BridgeRegistry, ProtocolBridgeRoute } from '../../types/protocol.js'
import { aleoAddressToBytes32, deriveXReservePrivateMintAddressCommitment as deriveAddressCommitment } from '../../utils/xreserve.js'
import { hyperlaneCommitmentToLimbs, validateHyperlaneAddressEncoding } from '../../utils/hyperlane.js'
import { parseDecimalAmount } from '../../utils/units.js'
import { createBridgeCheckpoint } from '../../actions/createBridgeCheckpoint.js'
import type { ReadHyperlaneClaimableAmountParameters, ScanHyperlaneAddressEncodingsParameters, HyperlaneAddressEncodingScanResult } from '../../types/hyperlane.js'

const PROGRAM = /^[a-zA-Z][a-zA-Z0-9_]*\.aleo$/

/**
 * Validates the explicitly reviewed private claim deployment without reading a chain.
 * Requires a pinned deployment and matching destination router before any source funds move.
 * @param route Supplies the canonical route from the injected registry.
 * @returns Reviewed claim program, mapping, freezelist, and mailbox identifiers.
 * @throws BridgeError When private deployment evidence or execution identifiers are missing.
 * @example const metadata = privateMintMetadata(route)
 */
export function privateMintMetadata(route: ProtocolBridgeRoute) {
  const m = route.metadata
  if (route.availability !== 'active' || m?.privateMintEncoding !== 'address_commitment_v1'
    || m.privateMintAbi !== 'claim_private_v1'
    || typeof m.privateMintProgram !== 'string' || !PROGRAM.test(m.privateMintProgram)
    || typeof m.privateMintMapping !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(m.privateMintMapping)
    || typeof m.privateMintFreezelistProgram !== 'string' || !PROGRAM.test(m.privateMintFreezelistProgram)
    || typeof m.privateMintCommit !== 'string' || !/^[0-9a-f]{40}$/.test(m.privateMintCommit)
    || typeof m.destinationRouter !== 'string' || m.destinationRouter.split('/')[0] !== m.privateMintProgram
    || typeof m.aleoMailboxProgram !== 'string' || !PROGRAM.test(m.aleoMailboxProgram)) {
    throw new BridgeError(`Hyperlane route lacks reviewed private claim metadata: ${route.id}`)
  }
  return { program: m.privateMintProgram, mapping: m.privateMintMapping, freezelistProgram: m.privateMintFreezelistProgram, mailbox: m.aleoMailboxProgram }
}

/**
 * Resolves recipient wire bytes and refuses unsupported private plans before network access.
 * Keeps public addresses and private commitments in their existing 32-byte source recipient slot.
 * @param registry Supplies the reviewed route catalog used to revalidate the plan.
 * @param plan Supplies the original recipient, amount, and optional wallet encoding.
 * @returns Source router bytes with a hexadecimal prefix and no byte reversal.
 * @throws BridgeError When the plan, recipient, commitment, private deployment, or u128 amount is invalid.
 * @example const recipientBytes32 = hyperlaneRecipient(registry, plan)
 */
export function hyperlaneRecipient(registry: BridgeRegistry, plan: BridgePlan): `0x${string}` {
  const { route, sourceChain, destinationChain, destinationAsset } = resolveTransferRoute(registry, plan)
  if (plan.hyperlane === undefined && plan.mintMode === 'public') return aleoAddressToBytes32(plan.recipient)
  if (plan.protocol !== 'hyperlane' || destinationChain.family !== 'aleo'
    || !['evm', 'solana'].includes(sourceChain.family) || plan.mintMode !== 'private') {
    throw new BridgeError('Address commitments require a private inbound Hyperlane plan')
  }
  privateMintMetadata(route)
  validateHyperlaneAddressEncoding(plan.hyperlane?.addressEncoding)
  aleoAddressToBytes32(plan.recipient)
  const amount = parseDecimalAmount(plan.amountIn, destinationAsset.decimals)
  if (amount <= 0n || amount >= 1n << 128n) throw new BridgeError('Hyperlane private claim amount must fit a positive u128')
  return `0x${plan.hyperlane!.addressEncoding.commitmentHex}`
}

/** Refuses public plans before accessing a private identity or contacting the destination. */
function validatePrivateClaimPlan(registry: BridgeRegistry, plan: BridgePlan): void {
  if (plan.protocol !== 'hyperlane' || plan.mintMode !== 'private' || plan.hyperlane === undefined) {
    throw new BridgeError('Hyperlane private claims require a private plan with its original address encoding')
  }
  hyperlaneRecipient(registry, plan)
}

/** Resolves a reviewed inbound claimable mapping before deriving or querying candidate encodings. */
function claimableDestination(registry: BridgeRegistry, routeId: string) {
  const route = registry.routes.find(entry => entry.id === routeId)
  const source = registry.assets.find(entry => entry.id === route?.sourceAssetId)
  const destination = registry.assets.find(entry => entry.id === route?.destinationAssetId)
  const sourceChain = registry.chains.find(entry => entry.id === source?.chainId)
  const destinationChain = registry.chains.find(entry => entry.id === destination?.chainId)
  if (!route || route.protocol !== 'hyperlane' || !sourceChain || !['evm', 'solana'].includes(sourceChain.family)
    || destinationChain?.family !== 'aleo') throw new BridgeError('Claimable lookup requires an inbound Hyperlane route to Aleo')
  const metadata = privateMintMetadata(route)
  return { ...metadata, chainId: destinationChain.id }
}

/**
 * Reads an address encoding's current claimable balance from its Aleo warp route.
 * Mapping presence is recovery evidence even when the balance is zero. Reads
 * only Aleo state; no source-chain receipt, message id, Circle API, or signature is required.
 * @param registry Supplies the reviewed inbound deployment, including its claimable mapping.
 * @param clients Supplies Aleo network access for the route's destination.
 * @param params Selects the route and canonical public encoding to inspect.
 * @returns The unsigned u128 balance in destination base units, or null for an absent encoding. Neither null nor zero proves completion.
 * @throws BridgeError When the deployment, encoding, network access, or mapping value is invalid.
 * @example const amount = await readHyperlaneClaimableAmount(registry, clients, { routeId, addressEncoding })
 */
export async function readHyperlaneClaimableAmount(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  params: ReadHyperlaneClaimableAmountParameters,
): Promise<bigint | null> {
  const metadata = claimableDestination(registry, params.routeId)
  const [lo, hi] = hyperlaneCommitmentToLimbs(params.addressEncoding)
  const value = await readContract(requireAleoClient(registry, clients, metadata.chainId).publicClient, {
    programId: metadata.program, mapping: metadata.mapping, key: `[${lo}u128, ${hi}u128]`,
  })
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{1,39}u128$/.test(value.trim()) || BigInt(value.trim().slice(0, -4)) >= 1n << 128n) {
    throw new BridgeError('Malformed Hyperlane claimable amount')
  }
  return BigInt(value.trim().slice(0, -4))
}

/**
 * Finds existing address encodings by checking derived counters against Aleo claimable state.
 * The caller retains custody of derivation keys. Queries every candidate in the
 * bounded range, including past gaps and zero balances, without issuing identities or submitting claims.
 * @param registry Supplies the reviewed Hyperlane destination and mapping.
 * @param clients Supplies destination Aleo network access; no source-chain client or Circle HTTP access is needed.
 * @param params Supplies the original derivation callback, counter range, and optional cancellation.
 * @returns Public entries and the next unchecked counter; secret nonces and keys are never returned or persisted.
 * @throws BridgeError When bounds, route, encodings, or mapping values are invalid. Propagates derivation, cancellation, and network failures without treating them as absent entries.
 * @example const result = await scanHyperlaneAddressEncodings(registry, clients, { routeId, deriveAddressEncoding, maxCounters: 100 })
 */
export async function scanHyperlaneAddressEncodings(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  params: ScanHyperlaneAddressEncodingsParameters,
): Promise<HyperlaneAddressEncodingScanResult> {
  const start = params.startCounter ?? 0
  const limit = params.maxCounters ?? 100
  if (!Number.isSafeInteger(start) || start < 0 || start > 0xffff_ffff
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100_000
    || typeof params.deriveAddressEncoding !== 'function') throw new BridgeError('Invalid Hyperlane encoding scan counter range or derivation callback')
  // Validate the route before invoking the caller's derivation capability.
  const destination = claimableDestination(registry, params.routeId)
  requireAleoClient(registry, clients, destination.chainId)
  const entries: HyperlaneAddressEncodingScanResult['entries'] = []
  const end = Math.min(start + limit, 0x1_0000_0000)
  for (let counter = start; counter < end; counter++) {
    params.signal?.throwIfAborted()
    const candidate = await params.deriveAddressEncoding(counter)
    params.signal?.throwIfAborted()
    validateHyperlaneAddressEncoding(candidate)
    // Keep the queried bytes stable if the caller reuses a mutable response object.
    const addressEncoding = { commitmentHex: candidate.commitmentHex }
    const claimableAmount = await readHyperlaneClaimableAmount(registry, clients, { routeId: params.routeId, addressEncoding })
    params.signal?.throwIfAborted()
    if (claimableAmount !== null) entries.push({ counter, addressEncoding: { commitmentHex: addressEncoding.commitmentHex }, claimableAmount })
  }
  return { entries, nextCounter: end > 0xffff_ffff ? undefined : end }
}

/**
 * Builds wallet grants for the exact private claim secret and recipient proof slots.
 * Reads only the supplied registry and plan; no wallet or chain is contacted.
 * @param options Supplies the reviewed route and private inbound transfer plan.
 * @returns Grants for `hyperlane-claim-secret` at input three and recipient proofs at input four.
 * @throws BridgeError When the private plan or reviewed deployment is invalid.
 * @example const grants = hyperlanePrivateClaimGrants({ registry, plan })
 */
export function hyperlanePrivateClaimGrants(options: { registry: BridgeRegistry; plan: BridgePlan }): AlgorithmGrant[] {
  validatePrivateClaimPlan(options.registry, options.plan)
  const { program, freezelistProgram } = privateMintMetadata(resolveTransferRoute(options.registry, options.plan).route)
  return [
    { algorithm: 'hyperlane-claim-secret', program, function: 'claim_private', inputPosition: 3 },
    { algorithm: 'program-freezelist-exclusion-proof', program, function: 'claim_private', inputPosition: 4, argConstraints: { freezelistProgram: [freezelistProgram] } },
  ]
}

/** Validates saved claim bytes against their transaction id, reviewed program, and public commitment. */
function preparedPrivateClaim(registry: BridgeRegistry, plan: BridgePlan, receipt: BridgeReceipt): Transaction | undefined {
  const serialized = receipt.protocolState.preparedDestinationTransaction
  if (serialized === undefined) return undefined
  let transaction: Transaction
  try {
    if (typeof serialized !== 'string' || !serialized) throw new Error()
    transaction = JSON.parse(serialized) as Transaction
  } catch {
    throw new BridgeError('Prepared Hyperlane claim contains an invalid serialized transaction')
  }
  const { program } = privateMintMetadata(resolveTransferRoute(registry, plan).route)
  const [lo, hi] = hyperlaneCommitmentToLimbs(plan.hyperlane!.addressEncoding)
  const transitions = transaction?.execution?.transitions
  const claims = Array.isArray(transitions) ? transitions.filter(t => t.program === program && t.function === 'claim_private') : []
  const inputs = claims[0]?.inputs
  if (transaction?.type !== 'execute' || !transaction.id || transaction.id !== receipt.id
    || (receipt.destinationTxId !== undefined && receipt.destinationTxId !== transaction.id)
    || claims.length !== 1 || inputs?.length !== 5 || inputs[0]?.type !== 'public'
    || inputs[0].value?.replace(/\s/g, '') !== `[${lo}u128,${hi}u128]`
    || inputs.slice(1).some(input => input.type !== 'private' || !input.value?.startsWith('ciphertext1'))) {
    throw new BridgeError('Prepared Hyperlane claim does not match its transaction id or reviewed claim inputs')
  }
  return transaction
}

/**
 * Checks destination claim confirmation or exposes a fresh wallet authorization boundary.
 * Reads Aleo claimable balance or transaction state without requesting a signature.
 * @param registry Supplies the reviewed private claim deployment.
 * @param clients Supplies Aleo network access for the plan's destination.
 * @param plan Supplies the original recipient commitment and planned claim amount.
 * @param receipt Supplies the last observed delivery or claim transaction state.
 * @returns Updated delivery, authorization, or accepted-claim state; rejected claims remain retryable.
 * @throws BridgeError When deployment metadata, saved identifiers, or chain values are invalid.
 * @example const next = await privateClaimStatus(registry, clients, plan, receipt)
 */
export async function privateClaimStatus(registry: BridgeRegistry, clients: BridgeChainClients, plan: BridgePlan, receipt: BridgeReceipt): Promise<BridgeReceipt> {
  validatePrivateClaimPlan(registry, plan)
  const { destinationChain, destinationAsset } = resolveTransferRoute(registry, plan)
  const client = requireAleoClient(registry, clients, destinationChain.id)
  const prepared = preparedPrivateClaim(registry, plan, receipt)
  let { nextAction: _nextAction, ...rest } = receipt
  if (receipt.status === 'DESTINATION_CONFIRMING' || prepared) {
    const transactionId = receipt.destinationTxId ?? prepared?.id
    if (!transactionId) throw new BridgeError('Hyperlane claim receipt is missing its destination transaction id')
    const result = await transactionStatus(client.publicClient, { transactionId })
    const { preparedDestinationTransaction: _prepared, ...protocolState } = rest.protocolState
    if (result.status === 'accepted') return { ...rest, protocolState, destinationTxId: transactionId, status: 'COMPLETED' }
    // Unknown prepared claims may only rebroadcast their saved bytes. Pending
    // claims and unknown submissions without bytes cannot authorize another claim.
    if (result.status === 'not_found' && prepared) return { ...rest, status: 'DESTINATION_ACTION_REQUIRED' }
    if (result.status !== 'rejected') return prepared
      ? { ...rest, status: 'DESTINATION_CONFIRMING', destinationTxId: transactionId }
      : receipt
    rest = { ...rest, protocolState, destinationTxId: undefined }
  }
  // The destination balance is authoritative even when source history or a message id is unavailable.
  const amount = parseDecimalAmount(plan.amountIn, destinationAsset.decimals)
  const claimable = await readHyperlaneClaimableAmount(registry, clients, { routeId: plan.route.id, addressEncoding: plan.hyperlane!.addressEncoding })
  if (claimable === null && ['SOURCE_APPROVAL_PENDING', 'SOURCE_SUBMISSION_PENDING', 'SOURCE_CONFIRMING'].includes(receipt.status)) return receipt
  if (claimable === null || claimable < amount) {
    return receipt.status === 'DELIVERY_PENDING' ? receipt : { ...rest, status: 'DELIVERY_PENDING' }
  }
  return { ...rest, status: 'DESTINATION_ACTION_REQUIRED' }
}

/**
 * Submits the reviewed five-input private claim after rechecking available funds.
 * Requests wallet authorization, proves, and broadcasts an Aleo transaction that spends destination gas.
 * Saves proved bytes before local broadcast and reuses them after an interrupted submission.
 * @param registry Supplies the reviewed claim program and recipient freezelist.
 * @param clients Supplies destination network access and the issuing wallet or local signer.
 * @param plan Supplies the original commitment, recipient, and destination amount.
 * @param receipt Supplies delivered funds awaiting claim authorization.
 * @param params Supplies optional local private inputs, fee preference, and checkpoint/progress callbacks.
 * @returns The submitted Aleo transaction id and resumable destination confirmation state.
 * @throws BridgeError When the claim is unfunded, inputs do not match, required capabilities are missing, or submission fails.
 * @example const result = await completePrivateClaim(registry, clients, plan, receipt, { plan, receipt })
 */
export async function completePrivateClaim(
  registry: BridgeRegistry, clients: BridgeChainClients, plan: BridgePlan, receipt: BridgeReceipt, params: CompleteParameters,
): Promise<{ transactionId: string; receipt: BridgeReceipt }> {
  validatePrivateClaimPlan(registry, plan)
  const { route, destinationChain, destinationAsset } = resolveTransferRoute(registry, plan)
  if (receipt.protocol !== 'hyperlane' || receipt.protocolState.routeId !== route.id
    || receipt.status !== 'DESTINATION_ACTION_REQUIRED' || receipt.nextAction !== undefined) throw new BridgeError('Hyperlane receipt has no private claim ready')
  const prepared = preparedPrivateClaim(registry, plan, receipt)
  const { nextAction: _nextAction, ...rest } = receipt
  const { preparedDestinationTransaction: _prepared, ...protocolState } = receipt.protocolState
  let submitted: BridgeReceipt | undefined
  let preparedId = prepared?.id
  const saveSubmitted = async (transactionId: string) => {
    if (!transactionId || (preparedId !== undefined && preparedId !== transactionId)
      || (submitted && submitted.destinationTxId !== transactionId)) throw new BridgeError('Hyperlane claim returned an empty or conflicting transaction id')
    if (submitted) return
    submitted = { ...rest, protocolState, status: 'DESTINATION_CONFIRMING', destinationTxId: transactionId }
    await params.onCheckpoint?.(createBridgeCheckpoint(plan, submitted))
  }
  if (prepared) {
    // Recheck a stale recovery result before broadcasting; no wallet or private
    // inputs are needed to observe or submit an already proved claim.
    const observed = await privateClaimStatus(registry, clients, plan, receipt)
    if (observed.status === 'COMPLETED' || observed.status === 'DESTINATION_CONFIRMING') {
      await params.onCheckpoint?.(createBridgeCheckpoint(plan, observed))
      return { transactionId: prepared.id, receipt: observed }
    }
    if (!observed.protocolState.preparedDestinationTransaction) throw new BridgeError('Prepared Hyperlane claim was rejected; recover before authorizing another claim')
    try {
      try {
        const transactionId = await requireAleoClient(registry, clients, destinationChain.id).publicClient.request({
          method: 'sendTransaction', params: { transaction: receipt.protocolState.preparedDestinationTransaction as string },
        })
        if (transactionId !== prepared.id) throw new BridgeError('Prepared Hyperlane claim broadcast returned a different transaction id')
      } catch (error) {
        if (error instanceof BridgeError) throw error
        const classified = classifyBroadcastError(error, prepared.id)
        if (!(classified instanceof DuplicateTransactionError)) throw classified
      }
      await saveSubmitted(prepared.id)
      await params.onProgress?.({ type: 'transaction-submitted', transactionId: prepared.id })
    } catch (cause) {
      if (submitted) throw new PrivateHyperlaneSubmissionError(submitted, createBridgeCheckpoint(plan, submitted), cause)
      throw cause
    }
    return { transactionId: prepared.id, receipt: submitted! }
  }
  const fresh = await privateClaimStatus(registry, clients, plan, { ...receipt, status: 'DELIVERY_PENDING' })
  if (fresh.status !== 'DESTINATION_ACTION_REQUIRED') throw new BridgeError('Hyperlane private claim is not funded')
  const { program, freezelistProgram } = privateMintMetadata(route)
  const wallet = requireAleoClientWithWallet(registry, clients, destinationChain.id, 'claim private Hyperlane funds').walletClient
  const commitmentHex = plan.hyperlane!.addressEncoding.commitmentHex
  const secret = params.hyperlane?.secretNonce
  const proof = params.hyperlane?.merkleProof
  if (wallet.account?.type === 'local' && (secret === undefined || typeof proof !== 'string')) {
    throw new BridgeError('Local Hyperlane claims require a secretNonce and recipient proof literal')
  }
  if (secret !== undefined && (!/^\d+scalar$/.test(secret)
    || await deriveAddressCommitment(plan.recipient, secret, route.environment) !== commitmentHex)) {
    throw new BridgeError('Hyperlane claim secret does not match the recipient commitment')
  }
  if (proof !== undefined && (typeof proof !== 'string' || !proof.trim())) throw new BridgeError('Supply a recipient proof literal or omit it for wallet derivation')
  const [lo, hi] = hyperlaneCommitmentToLimbs(plan.hyperlane!.addressEncoding)
  const amount = parseDecimalAmount(plan.amountIn, destinationAsset.decimals)
  const inputs: TransactionInput[] = [
    `[${lo}u128, ${hi}u128]`, `${amount}u128`, plan.recipient,
    secret ?? { type: 'derived', algorithm: 'hyperlane-claim-secret', args: {
      commitment: { type: 'string', value: commitmentHex }, recipient: { type: 'address', value: plan.recipient },
    } },
    proof ?? { type: 'derived', algorithm: 'program-freezelist-exclusion-proof', args: {
      freezelistProgram: { type: 'string', value: freezelistProgram }, address: { type: 'address', value: plan.recipient },
    } },
  ]
  try {
    const transactionId = await wallet.executeTransaction({ program, function: 'claim_private', inputs,
      privateFee: params.privateFee ?? false,
      onProgress: async event => {
        if (event.type === 'transaction-prepared') {
          const pending: BridgeReceipt = { ...rest, id: event.transactionId, destinationTxId: undefined,
            status: 'DESTINATION_CONFIRMING', protocolState: { ...protocolState, preparedDestinationTransaction: JSON.stringify(event.transaction) } }
          preparedPrivateClaim(registry, plan, pending)
          preparedId = event.transactionId
          // Persist encrypted transaction bytes before broadcast. Reporting gets
          // a copy so it cannot alter the proved transaction retained by the wallet.
          await params.onCheckpoint?.(createBridgeCheckpoint(plan, pending))
          await params.onProgress?.({ ...event, transaction: JSON.parse(JSON.stringify(event.transaction)) as Transaction })
          return
        }
        if (event.type === 'transaction-submitted') await saveSubmitted(event.transactionId)
        await params.onProgress?.(event)
      },
    })
    await saveSubmitted(transactionId)
    return { transactionId, receipt: submitted! }
  } catch (cause) {
    if (submitted) throw new PrivateHyperlaneSubmissionError(submitted, createBridgeCheckpoint(plan, submitted), cause)
    throw cause
  }
}
