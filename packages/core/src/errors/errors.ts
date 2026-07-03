/**
 * Base class for every error Veil throws.
 *
 * Catch it to distinguish Veil errors from unexpected runtime failures:
 * `error instanceof BaseError` is true for all errors in this module.
 */
export class BaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BaseError'
  }
}

/**
 * Thrown when a transport request fails — the node returned an error
 * response or could not be reached. Check the endpoint URL and network
 * reachability, then retry.
 */
export class TransportError extends BaseError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TransportError'
  }
}

/**
 * Thrown when an action that signs is called on a client with no account.
 * Create the client with `createWalletClient({ account, ... })`, or use
 * `createPublicClient` if only reads are needed.
 */
export class AccountNotFoundError extends BaseError {
  constructor() {
    super(
      'No account configured. To read data, use createPublicClient. ' +
      'To sign transactions, use createWalletClient with an account:\n' +
      '  createWalletClient({ account: rpcAccount(walletAdapter), transport: custom(walletAdapter) })',
    )
    this.name = 'AccountNotFoundError'
  }
}

/**
 * Thrown when a local account attempts a write action without a proving
 * configuration. Pass `proving` to `createWalletClient`, or switch to an
 * RPC account (wallet adapter), which proves internally.
 */
export class ProvingNotConfiguredError extends BaseError {
  constructor() {
    super(
      'No proving configuration found. Local accounts require a proving config:\n' +
      '  createWalletClient({ account, transport, proving: { mode: \'delegated\', url: \'...\' } })\n' +
      'Or use an RPC account (wallet adapter) which handles proving internally.',
    )
    this.name = 'ProvingNotConfiguredError'
  }
}

/**
 * Thrown when a string fails Aleo address validation. Valid addresses are
 * "aleo1" followed by 58 lowercase alphanumeric characters — check for
 * truncation or a copy-paste error.
 */
export class InvalidAddressError extends BaseError {
  constructor(address: string) {
    super(
      `Invalid Aleo address: "${address}". ` +
      'Aleo addresses start with "aleo1" followed by 58 lowercase alphanumeric characters.',
    )
    this.name = 'InvalidAddressError'
  }
}

/**
 * Thrown when a program ID does not resolve to a deployed program on the
 * connected network. Verify the ID and the target network — a program
 * deployed to testnet is not visible from mainnet.
 */
export class ProgramNotFoundError extends BaseError {
  constructor(program: string) {
    super(
      `Program "${program}" not found. ` +
      'Verify the program ID is correct and has been deployed. ' +
      `Check with: await client.getCode({ programId: '${program}' })`,
    )
    this.name = 'ProgramNotFoundError'
  }
}


/**
 * Thrown when a function argument does not match the type the program's
 * ABI expects. Encode arguments with `encodeValue()` before calling.
 *
 * @param functionName Transition whose argument failed validation.
 * @param expected Type the ABI requires, echoed in the message.
 * @param received The offending value as the caller passed it.
 */
export class InvalidInputError extends BaseError {
  constructor(functionName: string, expected: string, received: string) {
    super(
      `Invalid input for function "${functionName}": expected ${expected}, received "${received}". ` +
      'Use encodeValue() to convert values, e.g. encodeValue(100n, \'u64\') → \'100u64\'.',
    )
    this.name = 'InvalidInputError'
  }
}

/**
 * Thrown when `requestTransactionHistory` is called with a local account.
 * The Aleo REST API keeps no per-program history, so only RPC accounts
 * (connected wallet adapters) can serve this call — switch account type or
 * track transaction IDs in the application.
 */
export class TransactionHistoryNotSupportedError extends BaseError {
  constructor() {
    super(
      'requestTransactionHistory is not supported for local accounts — the ' +
      'Aleo network REST API has no per-program history endpoint, and the ' +
      'SDK does not provide one. This call only works with RPC accounts ' +
      '(connected wallet adapter), where the wallet keeps its own history.',
    )
    this.name = 'TransactionHistoryNotSupportedError'
  }
}

// ── Transaction lifecycle errors ─────────────────────────────────────

/**
 * Thrown when the network rejects a transaction as malformed before it
 * enters the mempool. Retrying unchanged will fail again — fix the
 * transaction's inputs or structure first.
 */
export class InvalidTransactionError extends BaseError {
  constructor(message: string, options?: ErrorOptions) {
    super(
      `Invalid transaction: ${message}. ` +
      'Verify that the transaction is well-formed and inputs are valid.',
      options,
    )
    this.name = 'InvalidTransactionError'
  }
}

/**
 * Thrown when a transaction with the same ID already exists in the ledger.
 * The earlier submission likely succeeded — check its status with
 * `getTransaction()` instead of resubmitting.
 *
 * @property transactionId On-chain transaction ID (`at1...`) when known.
 */
export class DuplicateTransactionError extends BaseError {
  readonly transactionId?: string

  constructor(transactionId?: string, options?: ErrorOptions) {
    super(
      `Transaction${transactionId ? ` ${transactionId}` : ''} already exists in the ledger. ` +
      'This transaction has already been submitted. ' +
      'If you intended a new transaction, ensure the inputs differ.',
      options,
    )
    this.name = 'DuplicateTransactionError'
    this.transactionId = transactionId
  }
}

/** A record was double-spent — the serial number has already been consumed */
export class RecordSpentError extends BaseError {
  constructor(message: string, options?: ErrorOptions) {
    super(
      `Record already spent: ${message}. ` +
      'This record\'s serial number has been consumed in another transaction. ' +
      'Fetch fresh records with requestRecords() before retrying.',
      options,
    )
    this.name = 'RecordSpentError'
  }
}

/** A record output ID collision — typically a program bug, not user-recoverable */
export class OutputIdCollisionError extends BaseError {
  constructor(message: string, options?: ErrorOptions) {
    super(
      `Output ID collision: ${message}. ` +
      'A record output produced by this transaction has a duplicate identifier. ' +
      'This is typically a program-level issue, not a double-spend.',
      options,
    )
    this.name = 'OutputIdCollisionError'
  }
}

/**
 * Thrown when submitting a transaction to the network fails for a reason
 * other than a malformed transaction or a duplicate — typically congestion
 * or a node-side failure. Safe to retry after a short delay.
 *
 * @property statusCode HTTP status of the failed broadcast, when the
 *   transport preserved one.
 */
export class BroadcastError extends BaseError {
  readonly statusCode?: number

  constructor(opts: { message: string; statusCode?: number; cause?: Error }) {
    super(
      `Transaction broadcast failed${opts.statusCode ? ` (HTTP ${opts.statusCode})` : ''}: ${opts.message}. ` +
      'The network may be congested. Retry after a short delay.',
      opts.cause ? { cause: opts.cause } : undefined,
    )
    this.name = 'BroadcastError'
    this.statusCode = opts.statusCode
  }
}

/**
 * Thrown when a submitted transaction is not confirmed within the polling
 * window. The transaction may still land — check `getTransaction()` before
 * resubmitting, or the retry raises a `DuplicateTransactionError`.
 *
 * @property transactionId ID of the transaction that was being awaited.
 * @property timeoutMs How long confirmation was polled, in milliseconds.
 */
export class TransactionTimeoutError extends BaseError {
  readonly transactionId: string
  readonly timeoutMs: number

  constructor(opts: { transactionId: string; timeoutMs: number; cause?: Error }) {
    super(
      `Transaction ${opts.transactionId} not confirmed within ${opts.timeoutMs / 1000}s. ` +
      'The transaction may still be pending — check its status with getTransaction() ' +
      'before resubmitting to avoid a DuplicateTransactionError.',
      opts.cause ? { cause: opts.cause } : undefined,
    )
    this.name = 'TransactionTimeoutError'
    this.transactionId = opts.transactionId
    this.timeoutMs = opts.timeoutMs
  }
}

/**
 * Thrown when a transaction reaches the chain but its finalize block
 * reverts, leaving it rejected with the base fee consumed. On-chain state
 * (mappings, balances) changed since the inputs were built — re-read state
 * and retry with fresh inputs.
 *
 * @property transactionId ID of the rejected transaction.
 */
export class FinalizeRevertError extends BaseError {
  readonly transactionId: string

  constructor(transactionId: string, options?: ErrorOptions) {
    super(
      `Transaction ${transactionId} was rejected — the finalize block reverted on-chain. ` +
      'The base fee has been consumed. Check that on-chain state (mappings, balances) ' +
      'still matches your expectations and retry with fresh inputs.',
      options,
    )
    this.name = 'FinalizeRevertError'
    this.transactionId = transactionId
  }
}

/**
 * Thrown when proof generation fails, locally or at a delegated proving
 * service. For delegated proving, check the prover URL and service status;
 * for local proving, check available memory and input validity.
 *
 * @property statusCode HTTP status from the proving service, when the
 *   failure was a service response rather than a local fault.
 */
export class ProvingError extends BaseError {
  readonly statusCode?: number

  constructor(opts: { message: string; statusCode?: number; cause?: Error }) {
    super(
      `Proof generation failed${opts.statusCode ? ` (HTTP ${opts.statusCode})` : ''}: ${opts.message}. ` +
      'If using delegated proving, check the prover service status. ' +
      'For local proving, ensure sufficient memory and valid program inputs.',
      opts.cause ? { cause: opts.cause } : undefined,
    )
    this.name = 'ProvingError'
    this.statusCode = opts.statusCode
  }
}

/** Configuration error — missing required options, not a proving or broadcast failure */
export class ConfigurationError extends BaseError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ConfigurationError'
  }
}

/**
 * Thrown when `simulateContract` is called with an RPC (wallet) account.
 * Wallets expose no dry-run interface — use a local account to simulate,
 * or call `executeContract` directly.
 */
export class SimulateNotSupportedError extends BaseError {
  constructor() {
    super(
      'simulateContract is not available for RPC (wallet) accounts. ' +
      'Wallets do not expose a local dry-run interface. ' +
      'Use executeContract for on-chain execution, or switch to a local account for simulation.',
    )
    this.name = 'SimulateNotSupportedError'
  }
}

// ── Error classification ─────────────────────────────────────────────

/** Safely extract HTTP status from an unknown error object */
function getStatus(e: unknown): number | undefined {
  return typeof e === 'object' && e !== null && 'status' in e && typeof (e as any).status === 'number'
    ? (e as any).status
    : undefined
}

/**
 * Classify a raw SDK error from submitTransaction or submitProvingRequest
 * into a typed Veil error. Parses error messages since submitTransaction
 * does not preserve HTTP status codes.
 */
export function classifyBroadcastError(
  error: unknown,
  transactionId?: string,
): InvalidTransactionError | DuplicateTransactionError | RecordSpentError | OutputIdCollisionError | BroadcastError {
  const message = error instanceof Error ? error.message : String(error)
  const status = getStatus(error)

  if (/already exists in the ledger/i.test(message)) {
    return new DuplicateTransactionError(transactionId, { cause: error as Error })
  }

  // Distinguish double-spend (serial number) from output ID collision
  if (/duplicate/i.test(message) && /serial.?number/i.test(message)) {
    return new RecordSpentError(message, { cause: error as Error })
  }
  if (/duplicate/i.test(message) && /output id|input id|commitment|nonce/i.test(message)) {
    return new OutputIdCollisionError(message, { cause: error as Error })
  }

  if (
    status === 400 || status === 422 ||
    /invalid transaction/i.test(message) ||
    /not well-formed/i.test(message) ||
    /incorrect transaction id/i.test(message) ||
    /fee verification failed/i.test(message)
  ) {
    return new InvalidTransactionError(message, { cause: error as Error })
  }

  return new BroadcastError({ message, statusCode: status, cause: error as Error })
}

/**
 * Classify a raw SDK error from proof generation or DPS submission.
 * Delegates to classifyBroadcastError if the message looks like a
 * broadcast failure (DPS surfaces broadcast errors through its response).
 */
export function classifyProvingError(
  error: unknown,
): ProvingError | InvalidTransactionError | DuplicateTransactionError | RecordSpentError | OutputIdCollisionError | BroadcastError {
  const message = error instanceof Error ? error.message : String(error)
  const status = getStatus(error)

  if (
    /already exists/i.test(message) ||
    /duplicate.*(?:output id|input id|commitment|nonce|serial)/i.test(message) ||
    /invalid transaction/i.test(message) ||
    /not well-formed/i.test(message)
  ) {
    return classifyBroadcastError(error)
  }

  return new ProvingError({ message, statusCode: status, cause: error as Error })
}
