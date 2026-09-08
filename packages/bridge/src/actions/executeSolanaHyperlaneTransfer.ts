import { BridgeError } from '../errors/bridgeErrors.js'
import { loadKit } from '../solana/kit.js'
import type { SolanaRpcReader } from '../solana/rpc.js'
import { buildTransferRemoteInstruction, type SolanaAccountMeta } from '../solana/transferRemote.js'
import type { BridgeRegistry, BridgeTransferReceipt } from '../types/protocol.js'
import type {
  ExecuteSolanaHyperlaneTransferParameters,
  SolanaBridgeExecutor,
  SolanaHyperlaneRouteMetadata,
  SolanaHyperlaneTransferExecution,
  SolanaHyperlaneTransferQuote,
} from '../types/solana.js'
import { quoteSolanaHyperlaneTransfer } from './quoteSolanaHyperlaneTransfer.js'
import { solanaRouteMetadata } from './solanaRouteMetadata.js'

// SEALEVEL_NOTES.md "Observed total lamport overhead": rent for the two
// program-derived accounts a transfer creates fresh — the gas-payment PDA
// (1,872,240 lamports) and the dispatched-message storage PDA (2,241,120
// lamports) — derived as the observed lamportDelta (7,023,360) minus the
// IGP gas payment (2,900,000) and the Solana network fee (10,000), both of
// which the quote already accounts for.
const RENT_OVERHEAD_LAMPORTS = 1_872_240n + 2_241_120n

// The rent-exempt minimum for a standard system-owned account (currently
// ~890,880 lamports; Solana's runtime derives it from account size and a
// network-wide rent rate that can in principle change). The sender's own
// account must stay above this floor after every lamport above leaves it,
// or the runtime rejects the transaction outright rather than leave a
// sub-rent-exempt account. Folding it into the preflight check fails safe
// either way it drifts from the live value: too high merely asks for a
// larger buffer than strictly required; too low would have the preflight
// pass while the broadcast still fails on-chain — same outcome as omitting
// it, not worse.
const SENDER_RENT_EXEMPT_MINIMUM_LAMPORTS = 890_880n

// SEALEVEL_NOTES.md §5: the Mailbox's full-hex dispatch log line is the only
// one that carries the untruncated message id; the IGP-payment and
// warp-completion log lines format it abbreviated and must not be parsed.
const DISPATCHED_MESSAGE_LOG_PATTERN = /Dispatched message to \d+, ID (0x[0-9a-fA-F]{64})/

/**
 * Extracts the Hyperlane message id from a confirmed Solana transaction's
 * program logs.
 *
 * Pure and local. Scans for the Mailbox's full-hex dispatch line, the only
 * log line that carries the untruncated 32-byte id; the abbreviated ids in
 * the IGP-payment and warp-completion lines are ignored. Applies to any
 * consumer that confirms a dispatch outside `executeSolanaHyperlaneTransfer`,
 * such as a resume path polling a previously broadcast signature.
 *
 * @param logs Program log lines of the confirmed transaction, or `null` when the transaction was not found.
 * @returns The `0x`-prefixed 64-hex-character message id, or `undefined` when no dispatch line is present.
 *
 * @example
 * const messageId = extractSolanaHyperlaneMessageId(await rpc.getTransactionLogs(signature))
 */
export function extractSolanaHyperlaneMessageId(logs: string[] | null): string | undefined {
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
 * A thrown error from the status read itself (a transient RPC hiccup, a rate
 * limit) never aborts the wait — the transaction was already broadcast, so
 * treating a read failure as a transfer failure would report a false
 * negative. Such errors are swallowed and polling continues until the
 * timeout, at which point the caller gets the same `undefined` timeout
 * outcome it would from a run of plain unresolved statuses.
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
    let status: Awaited<ReturnType<SolanaRpcReader['getSignatureStatus']>>
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
      // The transaction confirmed but the Mailbox dispatch log line was
      // absent or unparsable — note it rather than throwing.
      ...(status === 'DELIVERY_PENDING' && !messageId ? { messageIdUnavailable: true } : {}),
    },
  }
}

/**
 * Signs and submits a Solana-to-Aleo Hyperlane Warp Route transfer.
 *
 * Requotes the live IGP payment, then confirms the sender's balance covers
 * the transfer amount, gas, the rent overhead of the two accounts the
 * instruction creates, and the sender's own rent-exempt floor once every one
 * of those lamports has left it. Generates the ephemeral unique-message
 * signer, then assembles, partially signs, and hands the transaction to the
 * injected executor to sign and broadcast. Hits the network throughout,
 * prompts the executor for a signature, and moves funds; never local-only.
 *
 * When the plan names a `sender`, the executor's address MUST match it: a
 * plan prepared for one account is never executed by another connected
 * wallet or keypair. Mirrors the connected-account check in
 * `executeEvmHyperlaneTransfer`.
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
 * @throws BridgeError When route validation or quoting fails, the plan's sender does
 *   not match the executor's address, the sender's balance is insufficient, or the
 *   submitted transaction is reported failed.
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

  // 2. Resolve the fee payer and refuse to execute a plan prepared for a
  // different account, before any network read. Solana addresses are
  // case-sensitive base58, so an exact string comparison is the equality check.
  const senderAddress = await executor.getAddress()
  if (params.plan.sender && params.plan.sender !== senderAddress) {
    throw new BridgeError(`Prepared sender ${params.plan.sender} does not match connected account ${senderAddress}`)
  }

  // 3. Quote the live IGP payment through the shared oracle-reading action.
  const quote = await quoteSolanaHyperlaneTransfer(registry, rpc, { plan: params.plan })

  // 4. Preflight: the sender must cover the amount, gas, and the rent for
  // the two accounts (gas-payment PDA, dispatched-message PDA) the
  // instruction creates fresh, and must still clear its own rent-exempt
  // floor once every one of those lamports has left it.
  const rentLamports = RENT_OVERHEAD_LAMPORTS + SENDER_RENT_EXEMPT_MINIMUM_LAMPORTS
  const requiredLamports = quote.totalLamports + rentLamports
  const balance = await rpc.getBalance(senderAddress)
  if (balance < requiredLamports) {
    throw new BridgeError(
      `Insufficient Solana balance for this Hyperlane transfer: balance ${balance} lamports, `
      + `required ${requiredLamports} lamports (amount ${quote.amountLamports} `
      + `+ gas ${quote.igpPaymentLamports + quote.networkFeeLamports} + rent ${rentLamports})`,
    )
  }

  // 5. Generate the ephemeral unique-message signer that seeds the
  // dispatched-message and gas-payment program-derived addresses.
  const kit = await loadKit()
  const uniqueMessageSigner = await kit.generateKeyPairSigner()

  // 6. Build the instruction and assemble, compile, and partially sign the
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

  // 7. Hand the partially signed transaction to the executor, which adds the
  // fee payer's signature and submits it.
  const { signature } = await executor.signAndSendTransaction(wireTransaction)

  // Once broadcast, the transaction is out of this action's hands — any
  // error surfaced from here on must still name the signature, so a caller
  // (or an operator reading logs) can look it up rather than lose track of
  // an already-submitted transfer.
  try {
    // 8. Poll for confirmation; a timeout returns a resumable pending receipt
    // rather than throwing, since the transaction may still land.
    const confirmation = await pollForConfirmation(rpc, signature, pollingIntervalMs, confirmationTimeoutMs)
    if (!confirmation) {
      return {
        receipt: buildReceipt('SOURCE_CONFIRMING', signature, metadata, uniqueMessageSigner.address, quote),
      }
    }

    // 9. Extract the Hyperlane message id from the Mailbox dispatch log line.
    // Its absence does not throw — the receipt keeps the signature and leaves
    // `messageId` undefined.
    const logs = await rpc.getTransactionLogs(signature)
    const messageId = extractSolanaHyperlaneMessageId(logs)

    // 10. Return the resumable, protocol-neutral receipt.
    return {
      receipt: buildReceipt('DELIVERY_PENDING', signature, metadata, uniqueMessageSigner.address, quote, messageId),
    }
  } catch (error) {
    if (error instanceof BridgeError && error.message.includes(signature)) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new BridgeError(`Solana Hyperlane transfer ${signature} failed after broadcast: ${message}`, { cause: error })
  }
}
