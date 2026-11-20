import { transactionStatus, type AlgorithmGrant, type TransactionInput } from '@provablehq/veil-core'
import { resolveTransferRoute } from '../../actions/internal/resolveTransferRoute.js'
import { requireAleoClient, requireAleoClientWithWallet, type BridgeChainClients } from '../../connections/resolve.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { CompleteParameters } from '../../types/actions.js'
import type { BridgePlan, BridgeReceipt, BridgeRegistry, ProtocolBridgeRoute } from '../../types/protocol.js'
import { aleoAddressToBytes32, deriveXReservePrivateMintAddressCommitment } from '../../utils/xreserve.js'
import { hyperlaneCommitmentToLimbs, validateHyperlaneAddressEncoding } from '../../utils/hyperlane.js'
import { parseDecimalAmount } from '../../utils/units.js'
import { createBridgeCheckpoint } from '../../actions/createBridgeCheckpoint.js'
import { readHyperlaneDelivery } from '../../utils/hyperlaneDelivery.js'

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

/** Reads the current claimable balance, retaining missing entries as zero without guessing completion. */
async function claimableAmount(registry: BridgeRegistry, clients: BridgeChainClients, plan: BridgePlan): Promise<bigint> {
  validatePrivateClaimPlan(registry, plan)
  const { route, destinationChain } = resolveTransferRoute(registry, plan)
  const metadata = privateMintMetadata(route)
  const [lo, hi] = hyperlaneCommitmentToLimbs(plan.hyperlane!.addressEncoding)
  const value = await requireAleoClient(registry, clients, destinationChain.id).publicClient.request({
    method: 'getMappingValue', params: { programId: metadata.program, mapping: metadata.mapping, key: `[${lo}u128, ${hi}u128]` },
  })
  if (value === null) return 0n
  if (typeof value !== 'string' || !/^\d{1,39}u128$/.test(value.trim()) || BigInt(value.trim().slice(0, -4)) >= 1n << 128n) {
    throw new BridgeError('Malformed Hyperlane claimable amount')
  }
  return BigInt(value.trim().slice(0, -4))
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

/**
 * Checks destination claim confirmation or exposes a fresh wallet authorization boundary.
 * Reads Aleo delivery, balance, or transaction state without requesting a signature.
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
  const { route, destinationChain, destinationAsset } = resolveTransferRoute(registry, plan)
  const client = requireAleoClient(registry, clients, destinationChain.id)
  const { nextAction: _nextAction, ...rest } = receipt
  if (receipt.status === 'DESTINATION_CONFIRMING') {
    if (!receipt.destinationTxId) throw new BridgeError('Hyperlane claim receipt is missing its destination transaction id')
    const result = await transactionStatus(client.publicClient, { transactionId: receipt.destinationTxId })
    if (result.status === 'accepted') return { ...rest, status: 'COMPLETED' }
    // A rejected claim leaves source funds available; retry with the same identity.
    if (result.status !== 'rejected') return receipt
    return { ...rest, status: 'DESTINATION_ACTION_REQUIRED' }
  }
  if (!receipt.messageId) return receipt
  if (!await readHyperlaneDelivery(client, { mailbox: privateMintMetadata(route).mailbox, messageId: receipt.messageId })) return receipt
  const amount = parseDecimalAmount(plan.amountIn, destinationAsset.decimals)
  if (await claimableAmount(registry, clients, plan) < amount) {
    return receipt.status === 'DELIVERY_PENDING' ? receipt : { ...rest, status: 'DELIVERY_PENDING' }
  }
  return { ...rest, status: 'DESTINATION_ACTION_REQUIRED' }
}

/**
 * Submits the reviewed five-input private claim after rechecking delivery and available funds.
 * Requests wallet authorization, proves, and broadcasts an Aleo transaction that spends destination gas.
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
  const fresh = await privateClaimStatus(registry, clients, plan, { ...receipt, status: 'DELIVERY_PENDING' })
  if (fresh.status !== 'DESTINATION_ACTION_REQUIRED') throw new BridgeError('Hyperlane private claim is not funded or delivered')
  const { program, freezelistProgram } = privateMintMetadata(route)
  const wallet = requireAleoClientWithWallet(registry, clients, destinationChain.id, 'claim private Hyperlane funds').walletClient
  const commitmentHex = plan.hyperlane!.addressEncoding.commitmentHex
  const secret = params.hyperlane?.secretNonce
  const proof = params.hyperlane?.merkleProof
  if (wallet.account?.type === 'local' && (secret === undefined || typeof proof !== 'string')) {
    throw new BridgeError('Local Hyperlane claims require a secretNonce and recipient proof literal')
  }
  if (secret !== undefined && (!/^\d+scalar$/.test(secret)
    || await deriveXReservePrivateMintAddressCommitment(plan.recipient, secret, route.environment) !== commitmentHex)) {
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
  const transactionId = await wallet.executeTransaction({ program, function: 'claim_private', inputs,
    privateFee: params.privateFee ?? false, onProgress: params.onProgress,
  })
  if (!transactionId) throw new BridgeError('Aleo wallet returned an empty private claim transaction id')
  const { nextAction: _nextAction, ...rest } = receipt
  const submitted: BridgeReceipt = { ...rest, status: 'DESTINATION_CONFIRMING', destinationTxId: transactionId }
  await params.onCheckpoint?.(createBridgeCheckpoint(plan, submitted))
  return { transactionId, receipt: submitted }
}
