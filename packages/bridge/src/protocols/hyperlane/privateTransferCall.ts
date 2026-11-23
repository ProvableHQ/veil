import { freezelistProofGrant, freezelistProofRequest, parsePlaintextValue, parseRecord, readContract, type AlgorithmGrant, type Client, type Transaction, type TransactionInput } from '@provablehq/veil-core'
import { resolveTransferRoute } from '../../actions/internal/resolveTransferRoute.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { AleoHyperlanePrivateTransferCall, AleoHyperlanePrivateTransferQuote, BuildAleoHyperlanePrivateTransferParameters } from '../../types/hyperlanePrivateTransfer.js'
import type { BridgePlan, BridgeRegistry } from '../../types/protocol.js'
import { validateBridgeFreezelistProof } from '../../utils/freezelist.js'
import { buildTransferRemoteCall } from './aleo.js'
import { calculateHyperlanePrivateTransferAmount, privateTransferFingerprint } from './privateTransferFees.js'

const PROGRAM = /^[a-zA-Z][a-zA-Z0-9_]*\.aleo$/
const ZERO = `aleo1${'q'.repeat(52)}3ljyzc`
const MAX_U64 = (1n << 64n) - 1n

/** Resolves the explicitly activated private ABI and its token, proof, mailbox, and pause programs. @internal */
export function privateTransferProfile(registry: BridgeRegistry, plan: BridgePlan) {
  const resolved = resolveTransferRoute(registry, plan)
  const { route, sourceAsset, destinationAsset, sourceChain, destinationChain } = resolved
  const m = route.metadata
  if (route.protocol !== 'hyperlane' || sourceChain.family !== 'aleo' || !['evm', 'solana'].includes(destinationChain.family)
    || route.availability !== 'active' || m?.aleoPrivateTransferExecutionVerified !== true
    || m.aleoPrivateTransferAbi !== 'transfer_remote_private_v1'
    || typeof m.aleoPrivateTransferCommit !== 'string' || !/^[0-9a-f]{40}$/.test(m.aleoPrivateTransferCommit)
    || typeof m.aleoPrivateTransferTokenProgram !== 'string' || !PROGRAM.test(m.aleoPrivateTransferTokenProgram)
    || sourceAsset.privacy?.program !== m.aleoPrivateTransferTokenProgram || m.aleoPrivateTransferTokenProgram === 'credits.aleo'
    || typeof m.aleoPrivateTransferFreezelistProgram !== 'string' || !PROGRAM.test(m.aleoPrivateTransferFreezelistProgram)
    || typeof m.aleoMailboxProgram !== 'string' || !PROGRAM.test(m.aleoMailboxProgram)
    || typeof m.aleoPrivateTransferPauseMapping !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(m.aleoPrivateTransferPauseMapping)
    || typeof m.aleoPrivateTransferPauseKey !== 'string' || !['true', 'false'].includes(m.aleoPrivateTransferPauseKey)) {
    throw new BridgeError('Private Hyperlane execution requires a reviewed eleven-input deployment and token, freezelist, mailbox, and pause metadata')
  }
  const canonicalPlan = { ...plan, sourceAsset, destinationAsset }
  const base = buildTransferRemoteCall(registry, { plan: canonicalPlan, gasPaymentMicrocredits: 1n })
  if (base.usesPlaceholderConfiguration) throw new BridgeError('Private Hyperlane execution refuses placeholder route metadata')
  const proofAsset = { ...sourceAsset, privacy: { kind: 'arc22' as const, program: m.aleoPrivateTransferTokenProgram, freezelistProgram: m.aleoPrivateTransferFreezelistProgram } }
  return { ...resolved, canonicalPlan, base, proofAsset, tokenProgram: m.aleoPrivateTransferTokenProgram,
    freezelistProgram: m.aleoPrivateTransferFreezelistProgram, mailbox: m.aleoMailboxProgram,
    pauseMapping: m.aleoPrivateTransferPauseMapping, pauseKey: m.aleoPrivateTransferPauseKey as string,
  }
}

/** Validates record plaintext funding and ownership without exposing it in errors. @internal */
export function privateTransferRecord(input: string, field: 'amount' | 'microcredits', minimum: bigint, owner?: string) {
  try {
    const record = parseRecord(input)
    const value = record.fields[field]?.value
    const width = field === 'amount' ? 128 : 64
    if (typeof value !== 'bigint' || value < minimum || value >= 1n << BigInt(width)
      || !new RegExp(`\\b${field}\\s*:\\s*\\d+u${width}\\.`).test(input)
      || (owner !== undefined && record.owner !== owner) || record.fields.recipient_bound?.value === true) throw new Error()
    return { nonce: record.nonce, amount: value }
  } catch {
    throw new BridgeError(`Private Hyperlane ${field === 'amount' ? 'token' : 'credits'} record is malformed, underfunded, bound, or owned by another account`)
  }
}

/** Restricts wallet requests to the reviewed record and raises their funding filter to the required amount. */
function recordInput(input: TransactionInput | undefined, program: string, field: 'amount' | 'microcredits', minimum: bigint, owner?: string): TransactionInput {
  if (typeof input === 'string') { privateTransferRecord(input, field, minimum, owner); return input }
  const recordname = field === 'amount' ? 'Token' : 'credits'
  const literal = `${minimum}u${field === 'amount' ? 128 : 64}`
  if (input !== undefined && (input.type !== 'record' || input.program !== program || input.recordname !== recordname)) {
    throw new BridgeError('Private Hyperlane record request must select the reviewed program and record type')
  }
  if (input?.type === 'record' && input.uid !== undefined) {
    if (!input.uid || input.filters !== undefined) throw new BridgeError('Pinned wallet records require a nonempty uid and no filters')
    return { type: 'record', program, recordname, uid: input.uid }
  }
  return { type: 'record', program, recordname, filters: { [field]: { gte: literal } } }
}

/** Validates quote arithmetic and binds all spend-affecting public inputs to the original plan. @internal */
export function assertPrivateTransferQuote(registry: BridgeRegistry, plan: BridgePlan, quote: AleoHyperlanePrivateTransferQuote): void {
  const { route, base, sourceAsset, destinationAsset } = privateTransferProfile(registry, plan)
  const amounts = calculateHyperlanePrivateTransferAmount({ amountAtomic: base.amountAtomic, feeBps: quote.feeBps })
  const destination = destinationAsset.decimals >= sourceAsset.decimals
    ? amounts.netAmountAtomic * 10n ** BigInt(destinationAsset.decimals - sourceAsset.decimals)
    : amounts.netAmountAtomic / 10n ** BigInt(sourceAsset.decimals - destinationAsset.decimals)
  const m = route.metadata!
  const hooks = [m.aleoHook === ZERO ? m.aleoMailboxDefaultHook : m.aleoHook, m.aleoMailboxRequiredHook]
  if (!quote.transferFingerprint || quote.transferFingerprint !== privateTransferFingerprint(registry, plan)
    || quote.routeId !== route.id || quote.program !== base.program || quote.grossAmountAtomic !== base.amountAtomic
    || quote.tokenRecordAmountAtomic !== base.amountAtomic || quote.protocolFeeAtomic !== amounts.protocolFeeAtomic
    || quote.netAmountAtomic !== amounts.netAmountAtomic || quote.destinationAmountAtomic !== destination || destination <= 0n
    || !Array.isArray(quote.hookPayments) || quote.hookPayments.length !== 2
    || quote.hookPayments.some((payment, i) => payment.hook !== hooks[i] || typeof payment.paymentMicrocredits !== 'bigint'
      || payment.paymentMicrocredits < 0n || payment.paymentMicrocredits > MAX_U64)
    || (hooks[0] === hooks[1] && quote.hookPayments[0]!.paymentMicrocredits !== quote.hookPayments[1]!.paymentMicrocredits)
    || quote.hookPayments.reduce((sum, payment) => sum + payment.paymentMicrocredits, 0n) !== quote.dispatchCreditsRecordMicrocredits
    || quote.dispatchCreditsRecordMicrocredits > MAX_U64) {
    throw new BridgeError('Private Hyperlane quote does not match the original intent, deployment, token fee, or hook funding; quote again')
  }
}

/**
 * Builds the eleven-input private transfer call without contacting a wallet or chain.
 * Keeps private records and proof inputs in memory; callers must not persist the call.
 * @param registry Supplies the explicitly reviewed private deployment and compliance programs.
 * @param params Supplies the plan, displayed quote, and optional record/proof overrides.
 * @returns The private transition with gross token funding, both hook allowances, signer proof at nine, and fee bps at ten.
 * @throws BridgeError When the deployment, quote, records, or proof request is invalid.
 * @example const call = buildAleoHyperlanePrivateTransferCall(registry, { plan, quote })
 */
export function buildAleoHyperlanePrivateTransferCall(registry: BridgeRegistry, params: BuildAleoHyperlanePrivateTransferParameters): AleoHyperlanePrivateTransferCall {
  assertPrivateTransferQuote(registry, params.plan, params.quote)
  const p = privateTransferProfile(registry, params.plan)
  const token = recordInput(params.tokenRecord, p.tokenProgram, 'amount', params.quote.grossAmountAtomic, params.plan.sender)
  const credits = recordInput(params.dispatchCreditsRecord, 'credits.aleo', 'microcredits', params.quote.dispatchCreditsRecordMicrocredits, params.plan.sender)
  if (typeof token === 'string' && typeof credits === 'string'
    && parseRecord(token).nonce === parseRecord(credits).nonce) throw new BridgeError('Private Hyperlane records must be distinct')
  const proof = validateBridgeFreezelistProof(params.merkleProof ?? freezelistProofRequest({ freezelistProgram: p.freezelistProgram }), p.proofAsset)
  if (typeof proof === 'string' && !proof.trim()) throw new BridgeError('Private Hyperlane signer proof cannot be empty')
  // One allowance per unique hook permits each invocation's exact payment. The
  // dispatch credits record covers the sum, including repeated hook invocations.
  const payments = new Map(params.quote.hookPayments.map(payment => [payment.hook, payment.paymentMicrocredits]))
  const allowances = [...payments].map(([hook, payment]) => `{ spender: ${hook}, amount: ${payment}u64 }`)
  while (allowances.length < 4) allowances.push(`{ spender: ${ZERO}, amount: 0u64 }`)
  return { program: p.base.program, function: 'transfer_remote_private', inputs: [
    token, credits, ...p.base.inputs.slice(0, 6), `[${allowances.join(', ')}]`, proof, `${params.quote.feeBps}u16`,
  ] }
}

/**
 * Builds the wallet grant for the private outbound signer's exclusion proof at input nine.
 * Reads only reviewed registry metadata and never requests records or signatures.
 * @param options Supplies the registry and original outbound plan.
 * @returns A proof grant constrained to the reviewed warp, transition, slot, and freezelist.
 * @throws BridgeError When private execution metadata is unavailable or inconsistent.
 * @example const grants = hyperlanePrivateTransferGrants({ registry, plan })
 */
export function hyperlanePrivateTransferGrants(options: { registry: BridgeRegistry; plan: BridgePlan }): AlgorithmGrant[] {
  const p = privateTransferProfile(options.registry, options.plan)
  return [freezelistProofGrant({ program: p.base.program, function: 'transfer_remote_private', inputPosition: 9, freezelistProgram: p.freezelistProgram })]
}

/** Produces a deterministic comparison for parsed public structures regardless of field order. */
function stable(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${key}:${stable(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}

/** Checks live warp metadata, enrollment, mailbox hooks, and the outbound pause flag against the reviewed ABI. @internal */
export async function validatePrivateTransferState(registry: BridgeRegistry, client: Client, plan: BridgePlan): Promise<void> {
  const p = privateTransferProfile(registry, plan)
  const read = (programId: string, mapping: string, key: string) => readContract(client, { programId, mapping, key })
  const [app, router, mailbox, pause] = await Promise.all([
    read(p.base.program, 'app_metadata', 'true'),
    read(p.base.program, 'remote_routers', `${p.route.metadata!.aleoDestinationDomain}u32`),
    read(p.mailbox, 'mailbox', 'true'), read(p.base.program, p.pauseMapping, p.pauseKey),
  ])
  if (pause !== null) {
    const match = /^\[\s*(true|false)\s*,\s*(true|false)\s*\]$/.exec(pause.trim())
    if (!match) throw new BridgeError('Invalid private Hyperlane bridge pause state')
    if (match[2] === 'true') throw new BridgeError('Private Hyperlane outbound transfers are paused')
  }
  if (app === null || router === null || mailbox === null) throw new BridgeError('Missing live private Hyperlane route configuration')
  const box = parsePlaintextValue(mailbox) as Record<string, unknown>
  if (!box || typeof box !== 'object' || Array.isArray(box)
    || stable(parsePlaintextValue(app)) !== stable(parsePlaintextValue(p.base.inputs[0] as string))
    || stable(parsePlaintextValue(router)) !== stable(parsePlaintextValue(p.base.inputs[2] as string))
    || stable({ default_hook: box.default_hook, required_hook: box.required_hook }) !== stable(parsePlaintextValue(p.base.inputs[1] as string))) {
    throw new BridgeError('Live private Hyperlane metadata, router, or mailbox differs from the reviewed deployment; refresh the registry and quote again')
  }
}

/** Checks a proved private transaction's public inputs and distinct record serial numbers before broadcast. @internal */
export function validatePrivateTransferTransaction(transaction: Transaction, call: AleoHyperlanePrivateTransferCall): void {
  const transitions = transaction.execution?.transitions.filter(t => t.program === call.program && t.function === call.function)
  const inputs = transitions?.[0]?.inputs
  if (transaction.type !== 'execute' || transitions?.length !== 1 || inputs?.length !== 11) throw new BridgeError('Prepared private Hyperlane transaction does not contain the reviewed eleven-input call')
  for (const transition of transaction.execution!.transitions) {
    for (const value of [...(transition.inputs ?? []), ...(transition.outputs ?? [])]) {
      if (['private', 'record', 'external_record'].includes(value.type) && typeof value.value === 'string' && /^[\s]*[\[{]/.test(value.value)) {
        throw new BridgeError('Prepared private Hyperlane transaction exposes plaintext private data')
      }
    }
  }
  for (const index of [2, 3, 4, 5, 6, 7, 8, 10]) {
    if (inputs[index]?.type !== 'public' || typeof inputs[index]?.value !== 'string'
      || inputs[index]!.value!.replace(/\s/g, '') !== (call.inputs[index] as string).replace(/\s/g, '')) {
      throw new BridgeError('Prepared private Hyperlane public inputs differ from the approved transfer')
    }
  }
  if (![0, 1].every(i => ['record', 'external_record'].includes(inputs[i]!.type) && !!inputs[i]!.id) || inputs[9]?.type !== 'private') {
    throw new BridgeError('Prepared private Hyperlane record or proof input visibility is invalid')
  }
  const serials = [inputs[0]!.id, inputs[1]!.id]
  if (transaction.fee?.transition.function === 'fee_private') serials.push(transaction.fee.transition.inputs?.[0]?.id ?? '')
  if (serials.some(id => !id) || new Set(serials).size !== serials.length) throw new BridgeError('Private dispatch and execution fee records must be distinct')
}
