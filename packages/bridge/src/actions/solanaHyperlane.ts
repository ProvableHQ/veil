import { BridgeError } from '../errors/bridgeErrors.js'
import { quoteIgpGasPayment } from '../solana/igp.js'
import { loadKit } from '../solana/kit.js'
import type { SolanaRpcReader } from '../solana/rpc.js'
import { buildTransferRemoteInstruction, type SolanaAccountMeta } from '../solana/transferRemote.js'
import type { BridgeRegistry, BridgeTransferPlan, BridgeTransferReceipt } from '../types/protocol.js'
import type {
  ExecuteSolanaHyperlaneTransferParameters,
  QuoteSolanaHyperlaneTransferParameters,
  SolanaBridgeExecutor,
  SolanaHyperlaneRouteMetadata,
  SolanaHyperlaneTransferExecution,
  SolanaHyperlaneTransferQuote,
} from '../types/solana.js'
import { parseDecimalAmount } from '../utils/units.js'

// Base58, excluding the visually ambiguous 0/O/I/l — matches how Solana
// encodes a 32-byte account or program public key.
const SOLANA_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function requirePubkey(value: unknown, field: string, routeId: string): string {
  if (typeof value !== 'string' || !SOLANA_PUBKEY.test(value)) {
    throw new BridgeError(`Solana Hyperlane route has an invalid ${field}: ${routeId}`)
  }
  return value
}

/**
 * Validates a prepared transfer plan against the registry's Solana Hyperlane
 * route and returns its reviewed deployment metadata.
 *
 * Pure and local: confirms the plan's protocol, registry version, route
 * presence, asset pairing, and availability, then narrows and validates each
 * metadata field. Modeled on `routeMetadata` in `evmHyperlane.ts`.
 *
 * @param registry Reviewed deployment snapshot used to validate the prepared plan.
 * @param plan Prepared transfer plan naming the Solana Hyperlane route.
 * @returns The route's validated Solana Hyperlane deployment metadata.
 * @throws BridgeError When the plan is not a Hyperlane plan, was built from a
 *   different registry version, the route is missing from the registry, its
 *   assets do not match the plan, it is not active, or its metadata is
 *   absent or malformed.
 */
export function solanaRouteMetadata(
  registry: BridgeRegistry,
  plan: BridgeTransferPlan,
): SolanaHyperlaneRouteMetadata {
  if (plan.protocol !== 'hyperlane' || plan.route.protocol !== 'hyperlane') {
    throw new BridgeError('Solana Hyperlane actions require a Hyperlane transfer plan')
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
  if (!metadata) throw new BridgeError(`Solana Hyperlane route metadata is missing: ${plan.route.id}`)

  const routeId = plan.route.id
  const warpProgramAddress = requirePubkey(metadata.warpProgramAddress, 'warpProgramAddress', routeId)
  const tokenPda = requirePubkey(metadata.tokenPda, 'tokenPda', routeId)
  const nativeCollateralPda = requirePubkey(metadata.nativeCollateralPda, 'nativeCollateralPda', routeId)
  const dispatchAuthorityPda = requirePubkey(metadata.dispatchAuthorityPda, 'dispatchAuthorityPda', routeId)
  const mailboxProgramAddress = requirePubkey(metadata.mailboxProgramAddress, 'mailboxProgramAddress', routeId)
  const mailboxOutboxPda = requirePubkey(metadata.mailboxOutboxPda, 'mailboxOutboxPda', routeId)
  const igpProgramAddress = requirePubkey(metadata.igpProgramAddress, 'igpProgramAddress', routeId)
  const igpProgramDataPda = requirePubkey(metadata.igpProgramDataPda, 'igpProgramDataPda', routeId)
  const igpAccount = requirePubkey(metadata.igpAccount, 'igpAccount', routeId)
  const splNoopProgramAddress = requirePubkey(metadata.splNoopProgramAddress, 'splNoopProgramAddress', routeId)

  const igpOverheadAccountRaw = metadata.igpOverheadAccount
  const igpOverheadAccount = igpOverheadAccountRaw == null
    ? undefined
    : requirePubkey(igpOverheadAccountRaw, 'igpOverheadAccount', routeId)

  const destinationDomain = metadata.destinationDomain
  if (
    typeof destinationDomain !== 'number'
    || !Number.isInteger(destinationDomain)
    || destinationDomain < 0
    || destinationDomain > 0xffff_ffff
  ) {
    throw new BridgeError(`Solana Hyperlane route has an invalid destinationDomain: ${routeId}`)
  }

  const destinationGasAmount = metadata.destinationGasAmount
  if (typeof destinationGasAmount !== 'string' || !/^\d+$/.test(destinationGasAmount)) {
    throw new BridgeError(`Solana Hyperlane route has an invalid destinationGasAmount: ${routeId}`)
  }

  const registryCommit = metadata.registryCommit
  if (typeof registryCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(registryCommit)) {
    throw new BridgeError(`Solana Hyperlane route has an invalid registryCommit: ${routeId}`)
  }

  const solanaReviewedAt = metadata.solanaReviewedAt
  if (typeof solanaReviewedAt !== 'string' || Number.isNaN(Date.parse(solanaReviewedAt))) {
    throw new BridgeError(`Solana Hyperlane route has an invalid solanaReviewedAt: ${routeId}`)
  }

  const solanaConfigSource = metadata.solanaConfigSource
  if (typeof solanaConfigSource !== 'string' || solanaConfigSource.length === 0) {
    throw new BridgeError(`Solana Hyperlane route has an invalid solanaConfigSource: ${routeId}`)
  }

  return {
    warpProgramAddress,
    tokenPda,
    nativeCollateralPda,
    dispatchAuthorityPda,
    mailboxProgramAddress,
    mailboxOutboxPda,
    igpProgramAddress,
    igpProgramDataPda,
    igpAccount,
    ...(igpOverheadAccount == null ? {} : { igpOverheadAccount }),
    splNoopProgramAddress,
    destinationDomain,
    destinationGasAmount,
    registryCommit,
    solanaReviewedAt,
    solanaConfigSource,
  }
}

/**
 * Quotes a Solana-to-Aleo Hyperlane Warp Route transfer.
 *
 * Reads the reviewed route's terminal interchain gas paymaster account
 * through the injected Solana RPC reader and applies its on-chain gas-oracle
 * quote formula (SEALEVEL_NOTES.md §4). The call reads live chain state over
 * the network but never signs or submits a transaction.
 *
 * @param registry Reviewed deployment snapshot used to validate the prepared plan.
 * @param rpc Solana JSON-RPC reader used for the on-chain IGP account read.
 * @param params Prepared plan naming the Solana Hyperlane route to quote.
 * @returns Atomic lamport transfer amount, IGP gas payment, network fee, and their total.
 * @throws BridgeError When the route is not an active Solana Hyperlane source
 *   route, its metadata is incomplete or malformed, or the configured IGP
 *   account does not exist.
 *
 * @example
 * const quote = await quoteSolanaHyperlaneTransfer(registry, rpc, { plan })
 */
export async function quoteSolanaHyperlaneTransfer(
  registry: BridgeRegistry,
  rpc: SolanaRpcReader,
  params: QuoteSolanaHyperlaneTransferParameters,
): Promise<SolanaHyperlaneTransferQuote> {
  const metadata = solanaRouteMetadata(registry, params.plan)
  const amountLamports = parseDecimalAmount(params.plan.amountIn, params.plan.sourceAsset.decimals)

  const igpAccountData = await rpc.getAccountData(metadata.igpAccount)
  if (!igpAccountData) {
    throw new BridgeError(`Solana IGP account does not exist: ${metadata.igpAccount}`)
  }
  const igpPaymentLamports = quoteIgpGasPayment({
    igpAccountData,
    destinationDomain: metadata.destinationDomain,
    gasAmount: BigInt(metadata.destinationGasAmount),
  })

  // Two ed25519 signatures at 5,000 lamports each — the sender (fee payer)
  // and the freshly generated unique-message keypair (SEALEVEL_NOTES.md §2,
  // slots 6 and 7) — at Solana's fixed per-signature fee.
  const networkFeeLamports = 10_000n

  return {
    routeId: params.plan.route.id,
    amountLamports,
    igpPaymentLamports,
    networkFeeLamports,
    totalLamports: amountLamports + igpPaymentLamports + networkFeeLamports,
  }
}

// SEALEVEL_NOTES.md "Observed total lamport overhead": rent for the two
// program-derived accounts a transfer creates fresh — the gas-payment PDA
// (1,872,240 lamports) and the dispatched-message storage PDA (2,241,120
// lamports) — derived as the observed lamportDelta (7,023,360) minus the
// IGP gas payment (2,900,000) and the Solana network fee (10,000), both of
// which the quote already accounts for.
const RENT_OVERHEAD_LAMPORTS = 1_872_240n + 2_241_120n

// SEALEVEL_NOTES.md §5: the Mailbox's full-hex dispatch log line is the only
// one that carries the untruncated message id; the IGP-payment and
// warp-completion log lines format it abbreviated and must not be parsed.
const DISPATCHED_MESSAGE_LOG_PATTERN = /Dispatched message to \d+, ID (0x[0-9a-fA-F]{64})/

function extractMessageId(logs: string[] | null): string | undefined {
  if (!logs) return undefined
  for (const line of logs) {
    const match = DISPATCHED_MESSAGE_LOG_PATTERN.exec(line)
    if (match) return match[1]
  }
  return undefined
}

function accountRole(kit: Awaited<ReturnType<typeof loadKit>>, account: SolanaAccountMeta) {
  if (account.signer && account.writable) return kit.AccountRole.WRITABLE_SIGNER
  if (account.signer) return kit.AccountRole.READONLY_SIGNER
  if (account.writable) return kit.AccountRole.WRITABLE
  return kit.AccountRole.READONLY
}

/**
 * Polls a submitted Solana signature until Hyperlane's confirmation
 * threshold is reached, the network reports failure, or the caller's
 * timeout elapses.
 *
 * Pure network polling: sleeps `pollingIntervalMs` between reads and never
 * signs or submits. Mirrors `waitForReceipt` in `evmHyperlane.ts`.
 *
 * @param rpc Solana JSON-RPC reader used for the status lookup.
 * @param signature Submitted transaction signature to track.
 * @param pollingIntervalMs Delay between confirmation checks.
 * @param confirmationTimeoutMs Maximum time to wait before giving up.
 * @returns `'confirmed'` or `'finalized'` once reached, or `undefined` on timeout.
 * @throws BridgeError When the network reports the transaction failed.
 */
async function pollForConfirmation(
  rpc: SolanaRpcReader,
  signature: string,
  pollingIntervalMs: number,
  confirmationTimeoutMs: number,
): Promise<'confirmed' | 'finalized' | undefined> {
  const deadline = Date.now() + confirmationTimeoutMs
  do {
    const status = await rpc.getSignatureStatus(signature)
    if (status === 'failed') {
      throw new BridgeError(`Solana Hyperlane transfer failed on-chain: ${signature}`)
    }
    if (status === 'confirmed' || status === 'finalized') return status
    if (Date.now() >= deadline) return undefined
    await new Promise<void>((resolve) => setTimeout(resolve, pollingIntervalMs))
  } while (true)
}

function buildReceipt(
  status: Extract<BridgeTransferReceipt['status'], 'SOURCE_CONFIRMING' | 'DELIVERY_PENDING'>,
  signature: string,
  metadata: SolanaHyperlaneRouteMetadata,
  uniqueMessageAddress: string,
  quote: SolanaHyperlaneTransferQuote,
  messageId?: string,
): BridgeTransferReceipt {
  return {
    id: messageId ?? signature,
    protocol: 'hyperlane',
    status,
    sourceTxId: signature,
    ...(messageId ? { messageId } : {}),
    protocolState: {
      signature,
      uniqueMessageAddress,
      destinationDomain: metadata.destinationDomain,
      quotedLamports: quote.totalLamports.toString(),
      // Stage 8: the transaction confirmed but the Mailbox dispatch log line
      // was absent or unparsable — note it rather than throwing.
      ...(status === 'DELIVERY_PENDING' && !messageId ? { messageIdUnavailable: true } : {}),
    },
  }
}

/**
 * Signs and submits a Solana-to-Aleo Hyperlane Warp Route transfer.
 *
 * Requotes the live IGP payment, confirms the sender's balance covers the
 * transfer amount plus gas and the rent overhead of the two accounts the
 * instruction creates, generates the ephemeral unique-message signer, then
 * assembles, partially signs, and hands the transaction to the injected
 * executor to sign and broadcast. Hits the network throughout, prompts the
 * executor for a signature, and moves funds; never local-only.
 *
 * A confirmation timeout returns a resumable `SOURCE_CONFIRMING` receipt
 * rather than throwing — the signature is already submitted and may still
 * land. An absent or unparsable dispatch log likewise does not throw: the
 * returned receipt carries the signature with `messageId` left `undefined`.
 *
 * @param registry Reviewed deployment snapshot used to validate the prepared plan.
 * @param executor Connected Solana wallet or keypair executor that signs and submits the transaction.
 * @param rpc Solana JSON-RPC reader used for the blockhash, balance, and confirmation reads.
 * @param params Prepared plan and optional confirmation polling controls.
 * @returns The resumable Hyperlane transfer receipt.
 * @throws BridgeError When route validation or quoting fails, the sender's balance is
 *   insufficient, or the submitted transaction is reported failed.
 *
 * @example
 * const execution = await executeSolanaHyperlaneTransfer(registry, executor, rpc, { plan })
 */
export async function executeSolanaHyperlaneTransfer(
  registry: BridgeRegistry,
  executor: SolanaBridgeExecutor,
  rpc: SolanaRpcReader,
  params: ExecuteSolanaHyperlaneTransferParameters,
): Promise<SolanaHyperlaneTransferExecution> {
  const pollingIntervalMs = params.pollingIntervalMs ?? 1_000
  const confirmationTimeoutMs = params.confirmationTimeoutMs ?? 120_000
  if (!Number.isFinite(pollingIntervalMs) || pollingIntervalMs < 0) {
    throw new BridgeError('pollingIntervalMs must be a non-negative finite number')
  }
  if (!Number.isFinite(confirmationTimeoutMs) || confirmationTimeoutMs < 0) {
    throw new BridgeError('confirmationTimeoutMs must be a non-negative finite number')
  }

  // 1. Validate the route.
  const metadata = solanaRouteMetadata(registry, params.plan)

  // 2. Quote the live IGP payment (reuses this file's oracle-reading logic).
  const quote = await quoteSolanaHyperlaneTransfer(registry, rpc, { plan: params.plan })

  const senderAddress = await executor.getAddress()

  // 3. Preflight: the sender must cover the amount, gas, and the rent for
  // the two accounts (gas-payment PDA, dispatched-message PDA) the
  // instruction creates fresh.
  const requiredLamports = quote.totalLamports + RENT_OVERHEAD_LAMPORTS
  const balance = await rpc.getBalance(senderAddress)
  if (balance < requiredLamports) {
    throw new BridgeError(
      `Insufficient Solana balance for this Hyperlane transfer: balance ${balance} lamports, `
      + `required ${requiredLamports} lamports (amount ${quote.amountLamports} `
      + `+ gas ${quote.igpPaymentLamports + quote.networkFeeLamports} + rent ${RENT_OVERHEAD_LAMPORTS})`,
    )
  }

  // 4. Generate the ephemeral unique-message signer that seeds the
  // dispatched-message and gas-payment program-derived addresses.
  const kit = await loadKit()
  const uniqueMessageSigner = await kit.generateKeyPairSigner()

  // 5. Build the instruction and assemble, compile, and partially sign the
  // v0 transaction; the fee payer's signature is added later by the executor.
  const built = await buildTransferRemoteInstruction({
    metadata,
    senderAddress,
    uniqueMessageAddress: uniqueMessageSigner.address,
    recipientAleoAddress: params.plan.recipient,
    amountLamports: quote.amountLamports,
  })
  const instruction = {
    programAddress: kit.address(built.programAddress),
    accounts: built.accounts.map((account) => ({
      address: kit.address(account.address),
      role: accountRole(kit, account),
    })),
    data: built.data,
  }
  const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash()
  const message = kit.pipe(
    kit.createTransactionMessage({ version: 0 }),
    (tx) => kit.setTransactionMessageFeePayer(kit.address(senderAddress), tx),
    (tx) => kit.setTransactionMessageLifetimeUsingBlockhash(
      { blockhash: kit.blockhash(blockhash), lastValidBlockHeight },
      tx,
    ),
    (tx) => kit.appendTransactionMessageInstruction(instruction, tx),
  )
  const compiledTransaction = kit.compileTransaction(message)
  const signedTransaction = await kit.partiallySignTransaction(
    [uniqueMessageSigner.keyPair],
    compiledTransaction,
  )
  const wireTransaction = new Uint8Array(kit.getTransactionEncoder().encode(signedTransaction))

  // 6. Hand the partially signed transaction to the executor, which adds the
  // fee payer's signature and submits it.
  const { signature } = await executor.signAndSendTransaction(wireTransaction)

  // 7. Poll for confirmation; a timeout returns a resumable pending receipt
  // rather than throwing, since the transaction may still land.
  const confirmation = await pollForConfirmation(rpc, signature, pollingIntervalMs, confirmationTimeoutMs)
  if (!confirmation) {
    return {
      receipt: buildReceipt('SOURCE_CONFIRMING', signature, metadata, uniqueMessageSigner.address, quote),
    }
  }

  // 8. Extract the Hyperlane message id from the Mailbox dispatch log line.
  // Its absence does not throw — the receipt keeps the signature and leaves
  // `messageId` undefined.
  const logs = await rpc.getTransactionLogs(signature)
  const messageId = extractMessageId(logs)

  // 9. Return the resumable, protocol-neutral receipt.
  return {
    receipt: buildReceipt('DELIVERY_PENDING', signature, metadata, uniqueMessageSigner.address, quote, messageId),
  }
}
