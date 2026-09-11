import { BridgeError } from '../../errors/bridgeErrors.js'
import type { SolanaClient, SolanaWalletClient } from '../../connections/solana.js'
import { quoteIgpGasPayment } from '../../solana/igp.js'
import { loadKit } from '../../solana/kit.js'
import type { SolanaRpcClient } from '../../solana/rpc.js'
import { buildTransferRemoteInstruction, type SolanaAccountMeta } from '../../solana/transferRemote.js'
import { extractSolanaHyperlaneMessageId } from '../../solana/extractHyperlaneMessageId.js'
import type { BridgeRegistry, BridgeReceipt } from '../../types/protocol.js'
import type {
  ExecuteSolanaHyperlaneTransferParameters,
  SolanaHyperlaneRouteMetadata,
  SolanaHyperlaneTransferExecution,
  SolanaHyperlaneTransferQuote,
  QuoteSolanaHyperlaneTransferParameters,
} from '../../types/solana.js'
import { parseDecimalAmount } from '../../utils/units.js'
import { solanaRouteMetadata } from './solanaMetadata.js'

// SEALEVEL_NOTES.md "Observed total lamport overhead": rent for the two
// program-derived accounts a transfer creates fresh — the gas-payment PDA
// (1,872,240 lamports) and the dispatched-message storage PDA (2,241,120
// lamports) — derived as the observed lamportDelta (7,023,360) minus the
// IGP gas payment (2,900,000) and the Solana network fee (10,000), both of
// which the quote already accounts for.
const GAS_PAYMENT_ACCOUNT_DATA_LENGTH = 141
const DISPATCHED_MESSAGE_ACCOUNT_DATA_LENGTH = 194
const SOLANA_HYPERLANE_COMPUTE_UNIT_LIMIT = 400_000

function accountRole(kit: Awaited<ReturnType<typeof loadKit>>, account: SolanaAccountMeta) {
  if (account.signer && account.writable) return kit.AccountRole.WRITABLE_SIGNER
  if (account.signer) return kit.AccountRole.READONLY_SIGNER
  if (account.writable) return kit.AccountRole.WRITABLE
  return kit.AccountRole.READONLY
}

/**
 * Calculates the SOL required for a Solana-to-Aleo Hyperlane transfer.
 *
 * The total includes the transferred amount, relayer payment, current network
 * fee, and rent for accounts created by the dispatch. The action reads Solana
 * without requesting a signature or moving funds.
 *
 * @param registry Supported assets and reviewed Hyperlane deployments.
 * @param client Solana network access used to read route accounts, fees, and rent.
 * @param params Route, amount, recipient, and source account used to compile the fee quote.
 * @returns Transfer amount, relayer payment, network fee, rent, and total in lamports.
 * @throws BridgeError When the route is unavailable, no source account is supplied, or Solana returns invalid account or fee data.
 * @example const result = await quote(registry, client, { plan })
 */
export async function quote(
  registry: BridgeRegistry,
  client: SolanaClient,
  params: QuoteSolanaHyperlaneTransferParameters,
): Promise<SolanaHyperlaneTransferQuote> {
  // Validate every reviewed program and account address before reading Solana;
  // ports must not infer these deployment-specific accounts from token symbols.
  const metadata = solanaRouteMetadata(registry, params.plan)
  const rpc = client.publicClient
  const amountLamports = parseDecimalAmount(params.plan.amountIn, params.plan.sourceAsset.decimals)
  // The on-chain IGP account is authoritative for destination gas price and
  // exchange rate. A registry snapshot alone cannot safely quote this payment.
  const igpAccountData = await rpc.getAccountData(metadata.igpAccount)
  if (!igpAccountData) throw new BridgeError(`Solana IGP account does not exist: ${metadata.igpAccount}`)
  const igpPaymentLamports = quoteIgpGasPayment({
    igpAccountData,
    destinationDomain: metadata.destinationDomain,
    gasAmount: BigInt(metadata.destinationGasAmount),
  })
  if (!params.plan.sender) throw new BridgeError('Solana sender is required to quote the transaction fee')
  const kit = await loadKit()
  // A transfer creates message-specific PDAs, so even fee estimation needs a
  // disposable unique-message public key. No signature from this key is sent.
  const uniqueMessageSigner = await kit.generateKeyPairSigner()
  const built = await buildTransferRemoteInstruction({
    metadata,
    senderAddress: params.plan.sender,
    uniqueMessageAddress: uniqueMessageSigner.address,
    recipientAleoAddress: params.plan.recipient,
    amountLamports,
  })
  const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash()
  const message = kit.pipe(
    kit.createTransactionMessage({ version: 0 }),
    (transaction) => kit.setTransactionMessageFeePayer(kit.address(params.plan.sender!), transaction),
    (transaction) => kit.setTransactionMessageLifetimeUsingBlockhash({ blockhash: kit.blockhash(blockhash), lastValidBlockHeight }, transaction),
    (transaction) => kit.setTransactionMessageComputeUnitLimit(SOLANA_HYPERLANE_COMPUTE_UNIT_LIMIT, transaction),
    (transaction) => kit.appendTransactionMessageInstruction({
      programAddress: kit.address(built.programAddress),
      accounts: built.accounts.map((account) => ({ address: kit.address(account.address), role: accountRole(kit, account) })),
      data: built.data,
    }, transaction),
  )
  const compiled = kit.compileTransaction(message)
  // Network fee and rent are independent reads. Include both newly created
  // protocol accounts plus the sender's rent floor in the required balance.
  const [networkFeeLamports, gasPaymentRent, dispatchedMessageRent, senderRent] = await Promise.all([
    rpc.getFeeForMessage(new Uint8Array(compiled.messageBytes)),
    rpc.getMinimumBalanceForRentExemption(GAS_PAYMENT_ACCOUNT_DATA_LENGTH),
    rpc.getMinimumBalanceForRentExemption(DISPATCHED_MESSAGE_ACCOUNT_DATA_LENGTH),
    rpc.getMinimumBalanceForRentExemption(0),
  ])
  const rentLamports = gasPaymentRent + dispatchedMessageRent + senderRent
  return {
    routeId: params.plan.route.id,
    amountLamports,
    igpPaymentLamports,
    networkFeeLamports,
    rentLamports,
    totalLamports: amountLamports + igpPaymentLamports + networkFeeLamports + rentLamports,
  }
}

/**
 * Polls a submitted Solana signature until Hyperlane's confirmation
 * threshold is reached, the network reports failure, or the caller's
 * timeout elapses.
 *
 * Reads Solana repeatedly, sleeping `pollingIntervalMs` between requests. It
 * never signs or submits a transaction.
 *
 * A thrown error from the status read itself (a transient RPC hiccup, a rate
 * limit) never aborts the wait — the transaction was already broadcast, so
 * treating a read failure as a transfer failure would report a false
 * negative. Such errors are swallowed and polling continues until the
 * timeout, at which point the caller gets the same `undefined` timeout
 * outcome it would from a run of plain unresolved statuses.
 *
 * @param rpc Solana JSON-RPC client used for the status lookup.
 * @param signature Submitted transaction signature to track.
 * @param pollingIntervalMs Delay between confirmation checks.
 * @param confirmationTimeoutMs Maximum time to wait before giving up.
 * @returns A confirmed state, `'expired'` once the blockhash is invalid, or `undefined` on timeout.
 * @throws BridgeError When the network reports the transaction failed.
 */
async function pollForConfirmation(
  rpc: SolanaRpcClient,
  signature: string,
  pollingIntervalMs: number,
  confirmationTimeoutMs: number,
  blockhash: string,
): Promise<'confirmed' | 'finalized' | 'expired' | undefined> {
  const deadline = Date.now() + confirmationTimeoutMs
  do {
    let status: Awaited<ReturnType<SolanaRpcClient['getSignatureStatus']>>
    try {
      status = await rpc.getSignatureStatus(signature)
    } catch {
      // Transient status-read error: the signature is already broadcast, so
      // keep polling rather than surface this as an unsigned failure.
      status = null
    }
    if (status === 'failed') {
      throw new BridgeError(`Solana Hyperlane transfer failed on-chain: ${signature}`)
    }
    if (status === 'confirmed' || status === 'finalized') return status
    try {
      if (!await rpc.isBlockhashValid(blockhash)) return 'expired'
    } catch {
      // A blockhash-validity read is advisory while the signature may still land.
    }
    if (Date.now() >= deadline) return undefined
    await new Promise<void>((resolve) => setTimeout(resolve, pollingIntervalMs))
  } while (true)
}

function buildReceipt(
  status: Extract<BridgeReceipt['status'], 'SOURCE_CONFIRMING' | 'DELIVERY_PENDING'>,
  signature: string,
  routeId: string,
  metadata: SolanaHyperlaneRouteMetadata,
  uniqueMessageAddress: string,
  quote: SolanaHyperlaneTransferQuote,
  blockhash: string,
  lastValidBlockHeight: bigint,
  messageId?: string,
  blockhashExpired = false,
): BridgeReceipt {
  return {
    id: messageId ?? signature,
    protocol: 'hyperlane',
    status,
    sourceTxId: signature,
    ...(messageId ? { messageId } : {}),
    protocolState: {
      routeId,
      signature,
      uniqueMessageAddress,
      destinationDomain: metadata.destinationDomain,
      quotedLamports: quote.totalLamports.toString(),
      blockhash,
      lastValidBlockHeight: lastValidBlockHeight.toString(),
      ...(blockhashExpired ? { blockhashExpired: true } : {}),
      // The transaction confirmed but the Mailbox dispatch log line was
      // absent or unparsable — note it rather than throwing.
      ...(status === 'DELIVERY_PENDING' && !messageId ? { messageIdUnavailable: true } : {}),
    },
  }
}

/**
 * Checks whether one submitted Solana Hyperlane source transaction has committed funds.
 *
 * A pending signature leaves the state unchanged. A successful transaction
 * advances to destination delivery and records the canonical Hyperlane message
 * identifier when its log is available. No signature or submission occurs.
 *
 * @param client Solana network access used to read signature status and transaction logs.
 * @param receipt Latest state containing the submitted Solana signature.
 * @returns Unchanged source confirmation state or state ready to follow destination delivery.
 * @throws BridgeError When the saved state is invalid or Solana reports that the transaction failed.
 * @example const next = await getSourceStatus(client, receipt)
 */
export async function getSourceStatus(
  client: SolanaClient,
  receipt: BridgeReceipt,
): Promise<BridgeReceipt> {
  if (receipt.protocol !== 'hyperlane' || receipt.status !== 'SOURCE_CONFIRMING' || !receipt.sourceTxId) {
    throw new BridgeError('Solana Hyperlane source status requires a source-confirming receipt')
  }
  const status = await client.publicClient.getSignatureStatus(receipt.sourceTxId)
  if (status == null) {
    const { blockhash, lastValidBlockHeight } = receipt.protocolState
    if (blockhash === undefined && lastValidBlockHeight === undefined) return receipt
    if (typeof blockhash !== 'string' || !blockhash
      || typeof lastValidBlockHeight !== 'string' || !/^\d+$/.test(lastValidBlockHeight)) {
      throw new BridgeError('Solana Hyperlane source receipt has an invalid blockhash lifetime')
    }
    try {
      if (!await client.publicClient.isBlockhashValid(blockhash)) {
        return {
          ...receipt,
          status: 'EXPIRED',
          protocolState: {
            ...receipt.protocolState,
            blockhashExpired: true,
            sourceError: `Solana transaction expired before confirmation: ${receipt.sourceTxId}`,
          },
        }
      }
    } catch {
      return receipt
    }
    return receipt
  }
  if (status === 'processed') return receipt
  if (status === 'failed') throw new BridgeError(`Solana Hyperlane transfer failed on-chain: ${receipt.sourceTxId}`)
  // Confirmation proves the source instruction committed. The Mailbox log is
  // then the canonical source of the message id used for destination delivery.
  const messageId = extractSolanaHyperlaneMessageId(await client.publicClient.getTransactionLogs(receipt.sourceTxId))
  return {
    ...receipt,
    id: messageId ?? receipt.sourceTxId,
    status: 'DELIVERY_PENDING',
    ...(messageId ? { messageId } : {}),
    protocolState: {
      ...receipt.protocolState,
      ...(!messageId ? { messageIdUnavailable: true } : {}),
    },
  }
}

/**
 * Begins a Solana-to-Aleo Hyperlane transfer by committing SOL on Solana.
 *
 * The source account must cover the transfer, relayer payment, network fee, and
 * account rent while retaining its own rent-exempt floor. The connected wallet
 * MUST match any sender chosen earlier. After broadcast, a confirmation timeout
 * remains pending because the transaction may still land; it is not reported as
 * a failed transfer.
 *
 * @param registry Supported assets and reviewed Hyperlane deployments.
 * @param client Solana network and wallet access used to read, sign, and submit.
 * @param params Route, amount, Aleo recipient, confirmation controls, and optional recovery callback.
 * @returns The source signature and state needed to follow source confirmation or destination delivery.
 * @throws BridgeError When the route is unavailable, the wallet account differs from the selected sender, funds are insufficient, authorization fails, or Solana reports failure.
 *
 * @example
 * const execution = await execute(registry, client, { plan })
 */
export async function execute(
  registry: BridgeRegistry,
  client: SolanaClient & { walletClient: SolanaWalletClient },
  params: ExecuteSolanaHyperlaneTransferParameters,
): Promise<SolanaHyperlaneTransferExecution> {
  const rpc = client.publicClient
  const walletClient = client.walletClient
  const requestedPollingIntervalMs = params.pollingIntervalMs ?? 1_000
  const confirmationTimeoutMs = params.confirmationTimeoutMs ?? 120_000
  if (!Number.isFinite(requestedPollingIntervalMs) || requestedPollingIntervalMs < 0) {
    throw new BridgeError('pollingIntervalMs must be a non-negative finite number')
  }
  if (!Number.isFinite(confirmationTimeoutMs) || confirmationTimeoutMs < 0) {
    throw new BridgeError('confirmationTimeoutMs must be a non-negative finite number')
  }
  // Floor the effective interval so a caller-supplied 0 (or another very
  // small value) does not busy-poll the RPC endpoint.
  const pollingIntervalMs = Math.max(requestedPollingIntervalMs, 100)

  // 1. Validate the route.
  const metadata = solanaRouteMetadata(registry, params.plan)

  // A persisted source receipt represents an already-broadcast transaction.
  // Resume by observing that signature only; never quote, sign, or submit it again.
  if (params.resume) {
    const receipt = params.resume
    const state = receipt.protocolState
    if (receipt.protocol !== 'hyperlane'
      || (receipt.status !== 'SOURCE_CONFIRMING' && receipt.status !== 'DELIVERY_PENDING')
      || typeof receipt.sourceTxId !== 'string'
      || state.routeId !== params.plan.route.id
      || state.destinationDomain !== metadata.destinationDomain) {
      throw new BridgeError('Solana Hyperlane resume receipt does not match the prepared route')
    }
    if (receipt.status === 'DELIVERY_PENDING' || state.blockhashExpired === true) {
      return { receipt }
    }
    if (typeof state.blockhash !== 'string'
      || typeof state.lastValidBlockHeight !== 'string'
      || !/^\d+$/.test(state.lastValidBlockHeight)) {
      throw new BridgeError('Solana Hyperlane resume receipt is missing its blockhash lifetime')
    }
    const signature = receipt.sourceTxId
    try {
      const confirmation = await pollForConfirmation(
        client.publicClient,
        signature,
        pollingIntervalMs,
        confirmationTimeoutMs,
        state.blockhash,
      )
      if (!confirmation) return { receipt }
      if (confirmation === 'expired') {
        return { receipt: { ...receipt, protocolState: { ...state, blockhashExpired: true } } }
      }
      const messageId = extractSolanaHyperlaneMessageId(await client.publicClient.getTransactionLogs(signature))
      return {
        receipt: {
          ...receipt,
          id: messageId ?? signature,
          status: 'DELIVERY_PENDING',
          ...(messageId ? { messageId } : {}),
          protocolState: {
            ...state,
            ...(!messageId ? { messageIdUnavailable: true } : {}),
          },
        },
      }
    } catch (error) {
      if (error instanceof BridgeError && error.message.includes(signature)) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new BridgeError(`Solana Hyperlane transfer ${signature} was submitted, but confirmation failed: ${message}`)
    }
  }

  // 2. Resolve the fee payer and refuse to execute a plan prepared for a
  // different account, before any network read. Solana addresses are
  // case-sensitive base58, so an exact string comparison is the equality check.
  const senderAddress = await walletClient.getAddress()
  if (params.plan.sender && params.plan.sender !== senderAddress) {
    throw new BridgeError(`Prepared sender ${params.plan.sender} does not match connected account ${senderAddress}`)
  }

  // 3. Quote the live IGP payment through the shared oracle-reading action.
  const transferQuote = await quote(registry, client, { plan: { ...params.plan, sender: senderAddress } })

  // 4. Preflight: the sender must cover the amount, gas, and the rent for
  // the two accounts (gas-payment PDA, dispatched-message PDA) the
  // instruction creates fresh, and must still clear its own rent-exempt
  // floor once every one of those lamports has left it.
  const requiredLamports = transferQuote.totalLamports
  const balance = await rpc.getBalance(senderAddress)
  if (balance < requiredLamports) {
    throw new BridgeError(
      `Insufficient Solana balance for this Hyperlane transfer: balance ${balance} lamports, `
      + `required ${requiredLamports} lamports (amount ${transferQuote.amountLamports} `
      + `+ gas ${transferQuote.igpPaymentLamports + transferQuote.networkFeeLamports} + rent ${transferQuote.rentLamports})`,
    )
  }

  // 5. Generate the ephemeral unique-message signer that seeds the
  // dispatched-message and gas-payment program-derived addresses.
  const kit = await loadKit()
  const uniqueMessageSigner = await kit.generateKeyPairSigner()

  // 6. Build the instruction and assemble, compile, and partially sign the
  // v0 transaction; the fee payer's signature is added later by the wallet client.
  const built = await buildTransferRemoteInstruction({
    metadata,
    senderAddress,
    uniqueMessageAddress: uniqueMessageSigner.address,
    recipientAleoAddress: params.plan.recipient,
    amountLamports: transferQuote.amountLamports,
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
    (tx) => kit.setTransactionMessageComputeUnitLimit(SOLANA_HYPERLANE_COMPUTE_UNIT_LIMIT, tx),
    (tx) => kit.appendTransactionMessageInstruction(instruction, tx),
  )
  const compiledTransaction = kit.compileTransaction(message)
  const signedTransaction = await kit.partiallySignTransaction(
    [uniqueMessageSigner.keyPair],
    compiledTransaction,
  )
  const wireTransaction = new Uint8Array(kit.getTransactionEncoder().encode(signedTransaction))

  // 7. Hand the partially signed transaction to the wallet client, which adds the
  // fee payer's signature and submits it.
  const { signature } = await walletClient.sendTransaction(wireTransaction)
  const submittedReceipt = buildReceipt(
    'SOURCE_CONFIRMING',
    signature,
    params.plan.route.id,
    metadata,
    uniqueMessageSigner.address,
    transferQuote,
    blockhash,
    lastValidBlockHeight,
  )
  await params.onSubmitted?.(submittedReceipt)

  // Once broadcast, the transaction is out of this action's hands — any
  // error surfaced from here on must still name the signature, so a caller
  // (or an operator reading logs) can look it up rather than lose track of
  // an already-submitted transfer.
  try {
    // 8. Poll for confirmation; a timeout returns a resumable pending receipt
    // rather than throwing, since the transaction may still land.
    const confirmation = await pollForConfirmation(rpc, signature, pollingIntervalMs, confirmationTimeoutMs, blockhash)
    if (!confirmation) {
      return {
        receipt: submittedReceipt,
      }
    }
    if (confirmation === 'expired') {
      return {
        receipt: buildReceipt('SOURCE_CONFIRMING', signature, params.plan.route.id, metadata, uniqueMessageSigner.address, transferQuote, blockhash, lastValidBlockHeight, undefined, true),
      }
    }

    // 9. Extract the Hyperlane message id from the Mailbox dispatch log line.
    // Its absence does not throw — the receipt keeps the signature and leaves
    // `messageId` undefined.
    const logs = await rpc.getTransactionLogs(signature)
    const messageId = extractSolanaHyperlaneMessageId(logs)

    // 10. Return the resumable, protocol-neutral receipt.
    return {
      receipt: buildReceipt('DELIVERY_PENDING', signature, params.plan.route.id, metadata, uniqueMessageSigner.address, transferQuote, blockhash, lastValidBlockHeight, messageId),
    }
  } catch (error) {
    if (error instanceof BridgeError && error.message.includes(signature)) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new BridgeError(`Solana Hyperlane transfer ${signature} failed after broadcast: ${message}`, { cause: error })
  }
}
