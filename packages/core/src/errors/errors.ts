export class BaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BaseError'
  }
}

export class TransportError extends BaseError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TransportError'
  }
}

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

export class InvalidAddressError extends BaseError {
  constructor(address: string) {
    super(
      `Invalid Aleo address: "${address}". ` +
      'Aleo addresses start with "aleo1" followed by 58 lowercase alphanumeric characters.',
    )
    this.name = 'InvalidAddressError'
  }
}

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

export class InvalidInputError extends BaseError {
  constructor(functionName: string, expected: string, received: string) {
    super(
      `Invalid input for function "${functionName}": expected ${expected}, received "${received}". ` +
      'Use encodeValue() to convert values, e.g. encodeValue(100n, \'u64\') → \'100u64\'.',
    )
    this.name = 'InvalidInputError'
  }
}

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

export class RecordAlreadyUsedError extends BaseError {
  constructor(message: string, options?: ErrorOptions) {
    super(
      `Record already consumed: ${message}. ` +
      'A record input has already been spent in another transaction. ' +
      'Fetch fresh records with requestRecords() before retrying.',
      options,
    )
    this.name = 'RecordAlreadyUsedError'
  }
}

export class BroadcastError extends BaseError {
  readonly statusCode?: number

  constructor(message: string, statusCode?: number, options?: ErrorOptions) {
    super(
      `Transaction broadcast failed${statusCode ? ` (HTTP ${statusCode})` : ''}: ${message}. ` +
      'The network may be congested. Retry after a short delay.',
      options,
    )
    this.name = 'BroadcastError'
    this.statusCode = statusCode
  }
}

export class TransactionTimeoutError extends BaseError {
  readonly transactionId: string
  readonly timeoutMs: number

  constructor(transactionId: string, timeoutMs: number, options?: ErrorOptions) {
    super(
      `Transaction ${transactionId} not confirmed within ${timeoutMs / 1000}s. ` +
      'The transaction may still be pending — check its status with getTransaction() ' +
      'before resubmitting to avoid a DuplicateTransactionError.',
      options,
    )
    this.name = 'TransactionTimeoutError'
    this.transactionId = transactionId
    this.timeoutMs = timeoutMs
  }
}

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

export class ProvingError extends BaseError {
  readonly statusCode?: number

  constructor(message: string, statusCode?: number, options?: ErrorOptions) {
    super(
      `Proof generation failed${statusCode ? ` (HTTP ${statusCode})` : ''}: ${message}. ` +
      'If using delegated proving, check the prover service status. ' +
      'For local proving, ensure sufficient memory and valid program inputs.',
      options,
    )
    this.name = 'ProvingError'
    this.statusCode = statusCode
  }
}

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

/**
 * Classify a raw SDK error from submitTransaction or submitProvingRequest
 * into a typed Veil error. Parses error messages since submitTransaction
 * does not preserve HTTP status codes.
 */
export function classifyBroadcastError(
  error: unknown,
  transactionId?: string,
): InvalidTransactionError | DuplicateTransactionError | RecordAlreadyUsedError | BroadcastError {
  const message = error instanceof Error ? error.message : String(error)
  const status = (error as any)?.status as number | undefined

  if (/already exists in the ledger/i.test(message)) {
    return new DuplicateTransactionError(transactionId, { cause: error as Error })
  }

  if (
    /duplicate/i.test(message) &&
    /output id|input id|commitment|nonce|serial.?number/i.test(message)
  ) {
    return new RecordAlreadyUsedError(message, { cause: error as Error })
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

  return new BroadcastError(message, status, { cause: error as Error })
}

/**
 * Classify a raw SDK error from proof generation or DPS submission.
 * Delegates to classifyBroadcastError if the message looks like a
 * broadcast failure (DPS surfaces broadcast errors through its response).
 */
export function classifyProvingError(
  error: unknown,
): ProvingError | InvalidTransactionError | DuplicateTransactionError | RecordAlreadyUsedError | BroadcastError {
  const message = error instanceof Error ? error.message : String(error)
  const status = (error as any)?.status as number | undefined

  if (
    /already exists/i.test(message) ||
    /duplicate.*(?:output id|input id|commitment|nonce|serial)/i.test(message) ||
    /invalid transaction/i.test(message) ||
    /not well-formed/i.test(message)
  ) {
    return classifyBroadcastError(error)
  }

  return new ProvingError(message, status, { cause: error as Error })
}
