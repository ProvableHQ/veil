/**
 * Live mainnet verification for a Solana-to-Aleo SOL Hyperlane deposit.
 *
 * Prepares the reviewed `hyperlane:solana/sol->aleo/sol` route, prints a live
 * quote read from mainnet, then submits the transfer through a local keypair
 * executor and polls both legs of delivery: Solana confirmation of the
 * dispatch, and the destination balance increasing on Aleo once a Hyperlane
 * relayer processes the message. There is no per-message "delivered" read
 * anywhere in this SDK, so — the same way `testnet-round-trip.ts` polls a
 * token program's `balances` mapping for its xReserve mint leg — the
 * Aleo-side check polls a `balances` mapping for a balance increase. The
 * Solana route's destination asset locator names the Warp Route wrapper
 * (`hyp_warp_token_sol_v2.aleo`), but that program holds no balance mapping
 * of its own; it mints through the underlying `arc20_sol.aleo` ARC-20
 * program, whose `balances` mapping (keyed directly by address, confirmed
 * against a live `mint_public` call and its resulting balance) is what this
 * script reads.
 *
 * The journey is resumable: the submitted signature and message id are
 * checkpointed to a state file next to this script, so a crash or timeout
 * resumes polling instead of resubmitting. The fund-moving submission itself
 * is never retried.
 *
 * Usage (from packages/bridge):
 *   pnpm solana-deposit          # run or resume the journey
 *   pnpm solana-deposit --reset  # forget checkpoints, start fresh
 *
 * Environment (read from scripts/.env.solana-deposit when present):
 *   SOLANA_DEPOSIT_SECRET_KEY  Base58-encoded 64-byte Solana keypair, or a
 *                              JSON array of 64 byte values (Solana CLI format).
 *   SOLANA_RPC_URL             Solana JSON-RPC endpoint. Defaults to
 *                              https://api.mainnet-beta.solana.com.
 *   ALEO_RECIPIENT             Aleo address receiving the wrapped SOL.
 *   DEPOSIT_SOL                Decimal SOL amount to deposit. Defaults to 0.002.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import bs58 from 'bs58'
import {
  createBridgeClient,
  type SolanaRpcConfig,
} from '../src/index.js'
import {
  createSolanaRpcReader,
  solanaExecutorFromKeyPair,
} from '../src/solana/index.js'
import type { SolanaBridgeExecutor } from '../src/types/solana.js'
import { createPublicClient, http, type PublicClient } from '@provablehq/veil-core'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ENV_FILE = join(SCRIPT_DIR, '.env.solana-deposit')
const STATE_FILE = join(SCRIPT_DIR, '.solana-deposit.state.json')

const ROUTE_ID = 'hyperlane:solana/sol->aleo/sol'
const ALEO_API = 'https://api.provable.com/v2'
// The reviewed route's destination locator names the Warp Route wrapper, not
// the ARC-20 program actually holding balances (verified against a live
// `mint_public` call on mainnet — see the module docblock).
const ARC20_SOL_PROGRAM_ID = 'arc20_sol.aleo'
const CONFIRMATION_TIMEOUT_MS = 2 * 60_000
const DELIVERY_TIMEOUT_MS = 20 * 60_000
const DELIVERY_POLL_INTERVAL_MS = 20_000

type State = {
  senderAddress?: string
  aleoBalanceBeforeAtomic?: string
  dispatch?: { signature: string; status: 'SOURCE_CONFIRMING' | 'DELIVERY_PENDING'; messageId?: string; dispatchedAt?: string }
  delivered?: boolean
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function loadEnvFile(): void {
  if (!existsSync(ENV_FILE)) return
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (!match || process.env[match[1]!]) continue
    // Accept conventionally quoted dotenv values.
    process.env[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2')
  }
}

function loadState(): State {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}
}

function saveState(state: State): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retries a read-only call a few times with linear backoff.
 *
 * Applies only to non-fund-moving reads (quotes, balances) — mainnet public
 * RPC endpoints intermittently rate-limit, and a transient 429 should not
 * fail the whole run. Never wraps a submission.
 */
async function withRetry<T>(label: string, attempts: number, delayMs: number, call: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await call()
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
      log(`${label}: attempt ${attempt} failed (${String(error)}); retrying in ${delayMs / 1000}s`)
      await sleep(delayMs)
    }
  }
  throw lastError
}

/**
 * Polls a predicate until it yields a value, timing out or surfacing three
 * consecutive poll errors as a broken endpoint. Mirrors `poll` in
 * `testnet-round-trip.ts`.
 */
async function poll<T>(
  label: string,
  options: { timeoutMs: number, intervalMs: number },
  check: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs
  let consecutiveErrors = 0
  for (;;) {
    try {
      const value = await check()
      consecutiveErrors = 0
      if (value !== undefined) return value
    } catch (error) {
      consecutiveErrors += 1
      log(`${label}: poll error (${String(error)})`)
      if (consecutiveErrors >= 3) throw new Error(`${label}: failing persistently`, { cause: error })
    }
    if (Date.now() > deadline) throw new Error(`${label}: timed out after ${options.timeoutMs / 60000} minutes`)
    log(`${label}: still waiting (~${Math.max(0, Math.round((deadline - Date.now()) / 60000))} min left)`)
    await sleep(options.intervalMs)
  }
}

/** Converts an Aleo integer literal such as "123u128" (or null) to atomic units. */
function atomic(raw: string | null): bigint {
  if (raw == null) return 0n
  const digits = /^(\d+)u\d+$/.exec(raw)?.[1]
  if (!digits) throw new Error(`unexpected mapping value: ${raw}`)
  return BigInt(digits)
}

function formatAmount(value: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals)
  const fraction = (value % unit).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${value / unit}.${fraction}` : (value / unit).toString()
}

/** Decodes a base58 string or a Solana CLI JSON byte array into a 64-byte secret key. */
function secretKeyBytes(raw: string): Uint8Array {
  let bytes: Uint8Array
  if (raw.startsWith('[')) {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error('SOLANA_DEPOSIT_SECRET_KEY JSON must contain exactly 64 byte values')
    }
    bytes = Uint8Array.from(parsed as number[])
  } else {
    bytes = bs58.decode(raw)
  }
  if (bytes.length !== 64) {
    throw new Error('SOLANA_DEPOSIT_SECRET_KEY must be a base58-encoded 64-byte keypair or a Solana CLI JSON byte array')
  }
  return bytes
}

/** Reads the recipient's public balance of wrapped SOL from `arc20_sol.aleo`. */
async function arc20SolBalance(aleoReader: PublicClient, recipient: string): Promise<bigint> {
  return atomic(await aleoReader.readMapping({ programId: ARC20_SOL_PROGRAM_ID, mapping: 'balances', key: recipient }))
}

/**
 * Wraps a Solana executor so the signature it returns is checkpointed to the
 * state file the instant it comes back — before the calling action even
 * starts polling for confirmation.
 *
 * Without this, a crash or a thrown error between broadcast and the action
 * returning its receipt would leave `state.dispatch` unset, and a re-run
 * would have no record that a transaction was already sent — risking a
 * second, fund-duplicating submission. `invoked` flips to `true` as soon as
 * this wrapper is called, letting the caller tell a preflight failure
 * (nothing signed or sent yet) apart from a failure after signing was
 * attempted.
 */
function withDispatchCheckpoint(
  executor: SolanaBridgeExecutor,
  state: State,
  invoked: { value: boolean },
): SolanaBridgeExecutor {
  return {
    getAddress: () => executor.getAddress(),
    signAndSendTransaction: async (wireTransaction) => {
      invoked.value = true
      const result = await executor.signAndSendTransaction(wireTransaction)
      state.dispatch = {
        signature: result.signature,
        status: 'SOURCE_CONFIRMING',
        dispatchedAt: new Date().toISOString(),
      }
      saveState(state)
      return result
    },
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--reset')) {
    rmSync(STATE_FILE, { force: true })
    log('Checkpoint state cleared.')
  }
  loadEnvFile()

  const secretKeyRaw = process.env.SOLANA_DEPOSIT_SECRET_KEY
  const recipient = process.env.ALEO_RECIPIENT
  if (!secretKeyRaw || !recipient) {
    log('Missing SOLANA_DEPOSIT_SECRET_KEY or ALEO_RECIPIENT.')
    process.exitCode = 1
    return
  }
  const amount = process.env.DEPOSIT_SOL ?? '0.002'
  const rpc: SolanaRpcConfig = { url: process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com' }

  const rawExecutor = await solanaExecutorFromKeyPair({ secretKeyBytes: secretKeyBytes(secretKeyRaw), rpc })
  const senderAddress = await rawExecutor.getAddress()
  const solanaReader = createSolanaRpcReader(rpc)
  const aleoReader = createPublicClient({ transport: http(ALEO_API, { network: 'mainnet' }) })

  // Loaded before the executor is wrapped so the checkpointing wrapper below
  // can persist straight into this same object the instant a signature comes
  // back — see `withDispatchCheckpoint`.
  const state = loadState()
  state.senderAddress = senderAddress
  const executorInvoked = { value: false }
  const executor = withDispatchCheckpoint(rawExecutor, state, executorInvoked)

  const bridge = createBridgeClient({
    environment: 'mainnet',
    solanaRpc: rpc,
    executors: { solana: executor },
  })
  const plan = bridge.prepareTransfer({
    routeId: ROUTE_ID,
    amount,
    recipient,
    sender: senderAddress,
  })
  const decimals = plan.sourceAsset.decimals
  const warpProgramId = plan.destinationAsset.locator?.value
  if (!warpProgramId) throw new Error(`Destination asset has no program locator: ${plan.destinationAsset.id}`)

  log(`Solana sender:  ${senderAddress}`)
  log(`Aleo recipient: ${recipient}`)

  // ---- Quote: live reads only, no funds move. ----------------------------
  const quote = await withRetry('Solana quote', 3, 5_000, () => bridge.quoteSolanaHyperlaneTransfer({ plan }))
  const senderBalance = await withRetry('Solana balance', 3, 5_000, () => solanaReader.getBalance(senderAddress))

  console.log('Read-only Solana SOL to Aleo SOL preflight')
  console.table({
    route: ROUTE_ID,
    sender: senderAddress,
    recipient,
    amount: `${formatAmount(quote.amountLamports, decimals)} SOL`,
    nativeBalance: `${formatAmount(senderBalance, decimals)} SOL`,
    hyperlaneHookPayment: `${formatAmount(quote.igpPaymentLamports, decimals)} SOL`,
    solanaNetworkFee: `${formatAmount(quote.networkFeeLamports, decimals)} SOL`,
    totalRequired: `${formatAmount(quote.totalLamports, decimals)} SOL`,
    warpRouteProgram: warpProgramId,
    destinationDomain: plan.route.metadata?.destinationDomain ?? 'unknown',
  })

  // ---- Dispatch on Solana --------------------------------------------------
  // Nothing above this point touches the Aleo network — the quote and balance
  // reads are Solana-only, so a preflight failure (insufficient balance) never
  // depends on an Aleo read succeeding.
  // Captured as a boolean rather than narrowing on `state.dispatch` directly:
  // the wrapped executor mutates `state.dispatch` as a side effect partway
  // through the call below, which TypeScript's control-flow analysis cannot
  // see through, so a direct `if (!state.dispatch)` narrowing would go stale.
  const hadExistingDispatch = state.dispatch !== undefined
  if (!hadExistingDispatch) {
    log('Submitting the transfer through the local keypair executor.')
    // Never auto-retried: a post-broadcast error would risk a second dispatch.
    // `executor` checkpoints `state.dispatch` (via withDispatchCheckpoint) the
    // instant signAndSendTransaction returns a signature — before this call
    // even starts polling for confirmation — so state.dispatch may already be
    // populated by the time control reaches either branch below, or by the
    // time the catch block runs.
    let execution
    try {
      execution = await bridge.executeSolanaHyperlaneTransfer({
        plan,
        confirmationTimeoutMs: CONFIRMATION_TIMEOUT_MS,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!executorInvoked.value) {
        // Nothing was signed or sent yet — a route-validation, quoting, or
        // balance-preflight failure. Safe to report and let the operator
        // simply re-run.
        log(`Preflight failed: ${message}`)
        process.exitCode = 1
        return
      }
      // The executor was invoked, so a transaction may have been broadcast
      // (state.dispatch is already checkpointed if signAndSendTransaction
      // returned). Leave the checkpoint exactly as-is — do not clear it —
      // and tell the operator to resume rather than re-run from scratch.
      log(`Transfer submission or confirmation failed after signing was invoked: ${message}`)
      if (state.dispatch) {
        log(`Signature ${state.dispatch.signature} was already checkpointed before this failure.`)
      }
      log('Do not re-submit. Re-run this script to resume from the checkpoint; it will not resubmit a landed transaction.')
      process.exitCode = 1
      return
    }
    const receipt = execution.receipt
    log(`Transfer status: ${receipt.status}`)
    log(`Submitted Solana transaction: ${receipt.sourceTxId}`)
    if (receipt.status === 'SOURCE_CONFIRMING') {
      state.dispatch = { ...(state.dispatch ?? {}), signature: receipt.sourceTxId!, status: 'SOURCE_CONFIRMING' }
      saveState(state)
      log('Confirmation timed out before this run finished; the transaction was already broadcast.')
      log('Re-run this script to resume polling for confirmation — it will not resubmit.')
      process.exitCode = 1
      return
    }
    state.dispatch = {
      ...(state.dispatch ?? {}),
      signature: receipt.sourceTxId!,
      status: 'DELIVERY_PENDING',
      ...(receipt.messageId ? { messageId: receipt.messageId } : {}),
    }
    saveState(state)
    log('Solana dispatch confirmed.')
    log(`Hyperlane message id: ${receipt.messageId ?? 'not found in the confirmed transaction logs'}`)
  } else {
    log(`Resuming with existing dispatch ${state.dispatch!.signature} (${state.dispatch!.status})`)
  }

  if (!state.dispatch) {
    // Unreachable: every path above either returns or leaves state.dispatch
    // set. Guards the read below and gives TypeScript a fresh narrowing point.
    throw new Error('Internal error: no dispatch was recorded after submission.')
  }

  // ---- Resume: finish confirming a dispatch that timed out last run. -----
  if (state.dispatch.status === 'SOURCE_CONFIRMING') {
    const signature = state.dispatch.signature
    let logs: string[] | null = null
    const outcome = await poll('Solana confirmation', { timeoutMs: CONFIRMATION_TIMEOUT_MS, intervalMs: 2_000 }, async () => {
      const status = await solanaReader.getSignatureStatus(signature)
      if (status === 'confirmed' || status === 'finalized') return status
      if (status === null) {
        // getSignatureStatuses only reports recent activity and can forget an
        // older signature (e.g. across a long gap between runs) even though
        // it landed. Fall back to the full-history lookup (getTransaction,
        // commitment 'confirmed') before concluding it never landed.
        logs = await solanaReader.getTransactionLogs(signature)
        if (logs) return 'confirmed'
      }
      return undefined
    })
    log(`Solana transaction ${outcome}.`)
    logs ??= await solanaReader.getTransactionLogs(signature)
    const messageIdMatch = logs?.map((line) => /Dispatched message to \d+, ID (0x[0-9a-fA-F]{64})/.exec(line)?.[1]).find(Boolean)
    state.dispatch = { ...state.dispatch, signature, status: 'DELIVERY_PENDING', ...(messageIdMatch ? { messageId: messageIdMatch } : {}) }
    saveState(state)
    log(`Hyperlane message id: ${messageIdMatch ?? 'not found in the confirmed transaction logs'}`)
  }

  // Snapshot the recipient's Aleo balance once dispatch is confirmed, so a
  // resumed run compares against the pre-delivery balance rather than a
  // balance that may already reflect a completed delivery. Deliberately not
  // read any earlier: delivery takes a relayer several minutes at least, so
  // reading it now still precedes any possible delivery.
  if (state.aleoBalanceBeforeAtomic == null) {
    const before = await withRetry('Aleo balance (before)', 3, 5_000, () => arc20SolBalance(aleoReader, recipient))
    state.aleoBalanceBeforeAtomic = before.toString()
    saveState(state)
    log(`Aleo recipient balance before delivery: ${formatAmount(before, decimals)} SOL`)
  }
  const aleoBalanceBefore = BigInt(state.aleoBalanceBeforeAtomic)

  // ---- Aleo-side delivery check: poll the destination balance. -----------
  if (!state.delivered) {
    log('A Hyperlane relayer must deliver the message and mint SOL on Aleo before the balance changes.')
    const after = await poll('Aleo SOL delivery', { timeoutMs: DELIVERY_TIMEOUT_MS, intervalMs: DELIVERY_POLL_INTERVAL_MS }, async () => {
      const balance = await arc20SolBalance(aleoReader, recipient)
      return balance > aleoBalanceBefore ? balance : undefined
    })
    state.delivered = true
    saveState(state)
    log(`Delivered — Aleo recipient balance now ${formatAmount(after, decimals)} SOL (was ${formatAmount(aleoBalanceBefore, decimals)} SOL)`)
  }

  log('Verification complete. State file retained for the record; use --reset before a fresh run.')
}

main().catch((error) => {
  log(`FAILED: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  log('State is checkpointed — re-run to resume from the last completed step.')
  process.exitCode = 1
})
