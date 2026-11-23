import { getRecordInventory, parseRecord, type Client, type OwnedRecord, type Transaction, type TransactionInput } from '@provablehq/veil-core'
import { withBridgeContext, planSubject, baseWalletClient } from '../../actions/internal/clientContext.js'
import { assertRouteNotPaused } from '../../actions/internal/routePauseGuard.js'
import { readDestinationBalance } from '../../actions/internal/readDestinationBalance.js'
import { createBridgeCheckpoint } from '../../actions/createBridgeCheckpoint.js'
import { requireAleoClient, requireAleoClientWithWallet, type BridgeChainClients } from '../../connections/resolve.js'
import { BridgeError, PrivateHyperlaneSubmissionError } from '../../errors/bridgeErrors.js'
import type { AleoHyperlanePrivateTransferExecution, AleoHyperlanePrivateTransferQuote, ExecuteAleoHyperlanePrivateTransferParameters } from '../../types/hyperlanePrivateTransfer.js'
import type { BridgePlan, BridgeReceipt, BridgeRegistry } from '../../types/protocol.js'
import { resolveComplianceProof } from '../../utils/resolveComplianceProof.js'
import { buildAleoHyperlanePrivateTransferCall, privateTransferProfile, privateTransferRecord, assertPrivateTransferQuote, validatePrivateTransferState, validatePrivateTransferTransaction } from './privateTransferCall.js'
import { quoteAleoHyperlanePrivateTransfer } from './privateTransferFees.js'

/** Compares only spend-affecting quote data, including the recipient and reviewed input fingerprint. */
function quoteKey(quote: AleoHyperlanePrivateTransferQuote): string {
  return JSON.stringify([quote.routeId, quote.program, quote.transferFingerprint, quote.feeBps,
    quote.grossAmountAtomic.toString(), quote.protocolFeeAtomic.toString(), quote.netAmountAtomic.toString(),
    quote.destinationAmountAtomic.toString(), quote.dispatchCreditsRecordMicrocredits.toString(),
    quote.hookPayments.map(payment => [payment.hook, payment.paymentMicrocredits.toString()])])
}

/** Selects the smallest eligible local record through the existing core inventory interface. */
async function selectRecord(client: Client | undefined, program: string, minimum: bigint, owner: string | undefined, network: string): Promise<string> {
  if (!client || client.account?.type !== 'local' || client.account.address !== owner || client.transport.config.network !== network) {
    throw new BridgeError('Local private Hyperlane selection requires a recordClient for the same signer and network, or explicit token and dispatch records')
  }
  const inventory = await getRecordInventory(client, { asset: { program, recordName: program === 'credits.aleo' ? 'credits' : 'Token' } })
  const selected = inventory.available.filter(record => record.amount >= minimum && typeof (record.record as Partial<OwnedRecord>).recordPlaintext === 'string')
    .sort((a, b) => a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : a.id.localeCompare(b.id))[0]
  if (!selected) throw new BridgeError('No available private Hyperlane record covers the required funding')
  return (selected.record as OwnedRecord).recordPlaintext
}

/**
 * Executes a quoted eleven-input private outbound Hyperlane transfer.
 * Revalidates live configuration and fees before authorization and before local
 * broadcast, selects records through wallet requests or local inventory, and persists public recovery state.
 * @param registry Supplies the explicitly enabled private deployment and signer compliance metadata.
 * @param clients Supplies the source signer and destination balance reader; destination wallets are not required.
 * @param params Supplies the approved quote, private funding, execution-fee preference, and durable callbacks.
 * @returns The source transaction id and net destination verification state, without record plaintext or proofs.
 * @throws BridgeError When fees or configuration changed, records or permissions are unavailable, route pauses apply, or proving/submission fails.
 * @example const result = await executeAleoHyperlanePrivateTransfer(registry, clients, { plan, quote, onCheckpoint: save })
 */
export async function executeAleoHyperlanePrivateTransfer(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  params: ExecuteAleoHyperlanePrivateTransferParameters,
): Promise<AleoHyperlanePrivateTransferExecution> {
  // Snapshot public intent and quote bytes before any asynchronous provider can mutate them.
  const privateFee = params.privateFee ?? false
  const feeRecord = params.feeRecord
  const profile = privateTransferProfile(registry, params.plan)
  const plan = { ...profile.canonicalPlan, sourceAsset: { ...profile.sourceAsset }, destinationAsset: { ...profile.destinationAsset } }
  if (!Array.isArray(params.quote?.hookPayments)) throw new BridgeError('Private Hyperlane execution requires a valid displayed quote')
  const quote = { ...params.quote, hookPayments: params.quote.hookPayments.map(payment => ({ ...payment })) }
  assertPrivateTransferQuote(registry, plan, quote)
  clients = withBridgeContext(clients, 'execute', planSubject(plan))
  const source = requireAleoClientWithWallet(registry, clients, profile.sourceChain.id, 'execute a private Hyperlane transfer')
  const wallet = source.walletClient
  const owner = wallet.account?.address
  const accountType = wallet.account?.type
  if (plan.sender !== undefined && plan.sender !== owner) throw new BridgeError('Private Hyperlane sender does not match the connected signer')
  if (source.publicClient.transport?.config.network !== undefined && source.publicClient.transport.config.network !== profile.route.environment) {
    throw new BridgeError('Private Hyperlane source client uses a different network')
  }
  if (feeRecord !== undefined && !privateFee) throw new BridgeError('A private execution fee record requires privateFee')
  if (privateFee && (wallet.account?.type !== 'local' || !feeRecord)) {
    throw new BridgeError('Private Hyperlane execution fees require a local signer and a distinct explicit feeRecord; wallet accounts use public execution fees')
  }
  if (!params.skipRouteStatus) await assertRouteNotPaused(registry, clients, plan.route.id)
  const approved = quoteKey(quote)
  const assertSigner = () => {
    if (wallet.account?.address !== owner || wallet.account?.type !== accountType) throw new BridgeError('Private Hyperlane signer changed during preparation')
    if (source.publicClient.transport?.config.network !== undefined && source.publicClient.transport.config.network !== profile.route.environment) {
      throw new BridgeError('Private Hyperlane source network changed during preparation')
    }
  }
  const revalidate = async () => {
    assertSigner()
    await validatePrivateTransferState(registry, source.publicClient, plan)
    const fresh = await quoteAleoHyperlanePrivateTransfer(registry, source.publicClient, { plan })
    if (quoteKey(fresh) !== approved) throw new BridgeError('Private Hyperlane route or fees changed; review a fresh private transfer quote')
    assertSigner()
  }
  await revalidate()
  const before = await readDestinationBalance(registry, clients, plan)
  if (before === undefined) throw new BridgeError('Private Hyperlane execution requires a configured destination balance reader for recoverable net delivery verification')
  const verification = { destinationBalanceBeforeAtomic: before.toString(), expectedDestinationIncreaseAtomic: quote.destinationAmountAtomic.toString() }
  const base = baseWalletClient(wallet)
  const recordClient = params.recordClient ?? ('transport' in base && 'request' in base ? base as unknown as Client : undefined)
  let tokenRecord: TransactionInput | undefined = params.tokenRecord
  let dispatchRecord: TransactionInput | undefined = params.dispatchCreditsRecord
  if (wallet.account?.type === 'local') {
    tokenRecord ??= await selectRecord(recordClient, profile.tokenProgram, quote.grossAmountAtomic, owner, profile.route.environment)
    dispatchRecord ??= await selectRecord(recordClient, 'credits.aleo', quote.dispatchCreditsRecordMicrocredits, owner, profile.route.environment)
    if (typeof tokenRecord !== 'string' || typeof dispatchRecord !== 'string') throw new BridgeError('Local private Hyperlane execution requires record literals, not wallet input requests')
  }
  if (typeof tokenRecord === 'string') privateTransferRecord(tokenRecord, 'amount', quote.grossAmountAtomic, owner)
  if (typeof dispatchRecord === 'string') privateTransferRecord(dispatchRecord, 'microcredits', quote.dispatchCreditsRecordMicrocredits, owner)
  const fee = feeRecord === undefined ? undefined : privateTransferRecord(feeRecord, 'microcredits', 1n, owner)
  if (fee && [tokenRecord, dispatchRecord].some(record => typeof record === 'string' && parseRecord(record).nonce === fee.nonce)) {
    throw new BridgeError('Private dispatch and execution fee records must be distinct')
  }
  const proof = await resolveComplianceProof(source, profile.proofAsset, params.merkleProof)
  const call = buildAleoHyperlanePrivateTransferCall(registry, { plan, quote, tokenRecord, dispatchCreditsRecord: dispatchRecord, merkleProof: proof })
  // Records and compliance generation can take time; never authorize a stale fee snapshot.
  await revalidate()
  const receiptFor = (id: string, prepared?: Transaction): BridgeReceipt => ({
    id, protocol: 'hyperlane', status: prepared ? 'SOURCE_SUBMISSION_PENDING' : 'SOURCE_CONFIRMING',
    ...(prepared ? {} : { sourceTxId: id }),
    protocolState: { routeId: plan.route.id, sourceProgram: call.program, sourceFunction: call.function,
      ...verification, ...(prepared ? { preparedTransaction: JSON.stringify(prepared) } : {}),
    },
  })
  const expectedCall = { ...call, inputs: [...call.inputs] }
  let submitted: BridgeReceipt | undefined
  const saveSubmitted = async (id: string) => {
    if (submitted?.sourceTxId === id) return
    if (submitted) throw new BridgeError('Private Hyperlane wallet returned conflicting transaction ids')
    submitted = receiptFor(id)
    await params.onCheckpoint?.(createBridgeCheckpoint(plan, submitted))
  }
  let transactionId: string
  try {
    transactionId = await wallet.executeTransaction({
      program: call.program, function: call.function, inputs: call.inputs,
      privateFee: privateFee ?? false, ...(feeRecord ? { feeRecord: feeRecord } : {}),
      onProgress: async event => {
        if (event.type === 'transaction-prepared') {
          if (event.transactionId !== event.transaction.id) throw new BridgeError('Prepared private Hyperlane transaction id does not match its payload')
          validatePrivateTransferTransaction(event.transaction, expectedCall)
          if (privateFee && event.transaction.fee?.transition.function !== 'fee_private') throw new BridgeError('Prepared transaction does not use the selected private execution fee')
          if (fee) {
            const amounts = event.transaction.fee?.transition.inputs?.slice(1, 3).map(input => input.value)
            if (amounts?.length !== 2 || amounts.some(value => !/^\d+u64$/.test(value ?? ''))
              || amounts.reduce((sum, value) => sum + BigInt(value!.slice(0, -3)), 0n) > fee.amount) throw new BridgeError('Private execution fee record does not cover the prepared fee')
          }
          // Reporting receives a copy, so a callback cannot mutate the bytes
          // retained by the prover. Recheck live state after awaited storage/reporting.
          await params.onProgress?.({ ...event, transaction: JSON.parse(JSON.stringify(event.transaction)) as Transaction })
          await params.onCheckpoint?.(createBridgeCheckpoint(plan, receiptFor(event.transactionId, event.transaction)))
          await revalidate()
          return
        }
        if (event.type === 'transaction-submitted') await saveSubmitted(event.transactionId)
        await params.onProgress?.(event)
      },
    })
    if (!transactionId) throw new BridgeError('Aleo wallet returned an empty private Hyperlane transaction id')
    await saveSubmitted(transactionId)
  } catch (cause) {
    if (submitted) {
      // A callback or polling failure after submission must expose the known
      // public checkpoint instead of suggesting that the records can be spent again.
      throw new PrivateHyperlaneSubmissionError(submitted, createBridgeCheckpoint(plan, submitted), cause)
    }
    throw cause
  }
  return { transactionId, receipt: submitted! }
}

/** Revalidates immutable prepared bytes during recovery without selecting records or rebuilding a proof. @internal */
export async function validatePreparedPrivateTransfer(
  registry: BridgeRegistry, clients: BridgeChainClients, plan: BridgePlan, transaction: Transaction,
  expectedNet?: string,
): Promise<void> {
  const p = privateTransferProfile(registry, plan)
  const source = requireAleoClient(registry, clients, p.sourceChain.id)
  await validatePrivateTransferState(registry, source.publicClient, plan)
  const quote = await quoteAleoHyperlanePrivateTransfer(registry, source.publicClient, { plan })
  if (expectedNet === undefined || expectedNet !== quote.destinationAmountAtomic.toString()) throw new BridgeError('Prepared private Hyperlane recovery is missing or mismatches its net delivery verification')
  validatePrivateTransferTransaction(transaction, buildAleoHyperlanePrivateTransferCall(registry, { plan, quote }))
}
