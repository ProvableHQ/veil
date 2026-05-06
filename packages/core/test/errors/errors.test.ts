import { describe, it, expect, vi } from 'vitest'
import {
  AccountNotFoundError,
  InvalidAddressError,
  ProgramNotFoundError,
  InvalidInputError,
  ProvingNotConfiguredError,
  TransportError,
  BaseError,
  InvalidTransactionError,
  DuplicateTransactionError,
  RecordSpentError,
  OutputIdCollisionError,
  BroadcastError,
  TransactionTimeoutError,
  FinalizeRevertError,
  ProvingError,
  ConfigurationError,
  SimulateNotSupportedError,
  classifyBroadcastError,
  classifyProvingError,
} from '../../src/errors/errors.js'
import { writeContract } from '../../src/actions/wallet/writeContract.js'
import { deployContract } from '../../src/actions/wallet/deployContract.js'
import { signMessage } from '../../src/actions/wallet/signMessage.js'
import { decrypt } from '../../src/actions/wallet/decrypt.js'
import { simulateContract } from '../../src/actions/wallet/simulateContract.js'

describe('error classes', () => {
  it('AccountNotFoundError has actionable message with code example', () => {
    const err = new AccountNotFoundError()
    expect(err.name).toBe('AccountNotFoundError')
    expect(err.message).toContain('createWalletClient')
    expect(err.message).toContain('rpcAccount')
    expect(err.message).toContain('No account configured')
    expect(err).toBeInstanceOf(BaseError)
    expect(err).toBeInstanceOf(Error)
  })

  it('InvalidAddressError includes the bad address in message', () => {
    const err = new InvalidAddressError('0xbadaddress')
    expect(err.name).toBe('InvalidAddressError')
    expect(err.message).toContain('0xbadaddress')
    expect(err.message).toContain('aleo1')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('ProgramNotFoundError suggests getCode for debugging', () => {
    const err = new ProgramNotFoundError('my_token.aleo')
    expect(err.name).toBe('ProgramNotFoundError')
    expect(err.message).toContain('my_token.aleo')
    expect(err.message).toContain('getCode')
    expect(err.message).toContain('Verify the program ID')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('InvalidInputError includes function name and expected/received', () => {
    const err = new InvalidInputError('transfer', '2 inputs', '3')
    expect(err.name).toBe('InvalidInputError')
    expect(err.message).toContain('transfer')
    expect(err.message).toContain('2 inputs')
    expect(err.message).toContain('encodeValue')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('ProvingNotConfiguredError has code example', () => {
    const err = new ProvingNotConfiguredError()
    expect(err.name).toBe('ProvingNotConfiguredError')
    expect(err.message).toContain('proving')
    expect(err.message).toContain('delegated')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('TransportError preserves cause chain', () => {
    const cause = new Error('network failure')
    const err = new TransportError('HTTP 500: Internal Server Error', { cause })
    expect(err.name).toBe('TransportError')
    expect(err.cause).toBe(cause)
    expect(err).toBeInstanceOf(BaseError)
  })
})

describe('error paths in wallet actions', () => {
  it('writeContract throws AccountNotFoundError when no account', async () => {
    const client = {
      account: undefined,
      request: vi.fn(),
    } as any

    await expect(writeContract(client, {
      program: 'token.aleo',
      function: 'transfer',
      inputs: [],
    })).rejects.toThrow(AccountNotFoundError)
  })

  it('writeContract throws AccountNotFoundError for view-only account', async () => {
    const client = {
      account: { address: 'aleo1abc' },
      request: vi.fn(),
    } as any

    await expect(writeContract(client, {
      program: 'token.aleo',
      function: 'transfer',
      inputs: [],
    })).rejects.toThrow(AccountNotFoundError)
  })

  it('deployContract throws AccountNotFoundError when no account', async () => {
    const client = {
      account: undefined,
      request: vi.fn(),
    } as any

    await expect(deployContract(client, {
      program: 'my_program.aleo',
    })).rejects.toThrow(AccountNotFoundError)
  })

  it('signMessage throws AccountNotFoundError when no account', async () => {
    const client = {
      account: undefined,
      request: vi.fn(),
    } as any

    await expect(signMessage(client, {
      message: new Uint8Array([1]),
    })).rejects.toThrow(AccountNotFoundError)
  })

  it('decrypt throws AccountNotFoundError when no account', async () => {
    const client = {
      account: undefined,
      request: vi.fn(),
    } as any

    await expect(decrypt(client, {
      cipherText: 'record1...',
    })).rejects.toThrow(AccountNotFoundError)
  })

  it('simulateContract throws SimulateNotSupportedError for RPC account', async () => {
    const client = {
      account: { type: 'rpc', address: 'aleo1abc', sign: vi.fn() },
      request: vi.fn(),
    } as any

    await expect(simulateContract(client, {
      program: 'token.aleo',
      function: 'mint',
      inputs: [],
    })).rejects.toThrow(SimulateNotSupportedError)
  })
})

describe('typed transaction errors', () => {
  it('InvalidTransactionError includes message and is BaseError', () => {
    const err = new InvalidTransactionError('Fee verification failed: insufficient balance')
    expect(err.name).toBe('InvalidTransactionError')
    expect(err.message).toContain('Fee verification failed')
    expect(err.message).toContain('well-formed')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('DuplicateTransactionError includes transactionId', () => {
    const err = new DuplicateTransactionError('at1abc')
    expect(err.name).toBe('DuplicateTransactionError')
    expect(err.transactionId).toBe('at1abc')
    expect(err.message).toContain('at1abc')
    expect(err.message).toContain('already exists')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('DuplicateTransactionError works without transactionId', () => {
    const err = new DuplicateTransactionError()
    expect(err.transactionId).toBeUndefined()
    expect(err.message).toContain('already exists')
  })

  it('RecordSpentError includes message', () => {
    const err = new RecordSpentError('Found a duplicate serial_number')
    expect(err.name).toBe('RecordSpentError')
    expect(err.message).toContain('serial_number')
    expect(err.message).toContain('requestRecords')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('OutputIdCollisionError includes message', () => {
    const err = new OutputIdCollisionError('Found a duplicate Output ID')
    expect(err.name).toBe('OutputIdCollisionError')
    expect(err.message).toContain('Output ID')
    expect(err.message).toContain('program-level')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('ConfigurationError includes message', () => {
    const err = new ConfigurationError('Delegated execution requires proverUrl')
    expect(err.name).toBe('ConfigurationError')
    expect(err.message).toContain('proverUrl')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('BroadcastError includes statusCode', () => {
    const err = new BroadcastError({ message: 'service unavailable', statusCode: 503 })
    expect(err.name).toBe('BroadcastError')
    expect(err.statusCode).toBe(503)
    expect(err.message).toContain('503')
    expect(err.message).toContain('congested')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('BroadcastError works without statusCode', () => {
    const err = new BroadcastError({ message: 'unknown failure' })
    expect(err.statusCode).toBeUndefined()
    expect(err.message).toContain('unknown failure')
  })

  it('TransactionTimeoutError includes txId and timeout', () => {
    const err = new TransactionTimeoutError({ transactionId: 'at1xyz', timeoutMs: 300_000 })
    expect(err.name).toBe('TransactionTimeoutError')
    expect(err.transactionId).toBe('at1xyz')
    expect(err.timeoutMs).toBe(300_000)
    expect(err.message).toContain('at1xyz')
    expect(err.message).toContain('300s')
    expect(err.message).toContain('getTransaction')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('FinalizeRevertError includes txId', () => {
    const err = new FinalizeRevertError('at1def')
    expect(err.name).toBe('FinalizeRevertError')
    expect(err.transactionId).toBe('at1def')
    expect(err.message).toContain('at1def')
    expect(err.message).toContain('reverted')
    expect(err.message).toContain('fee has been consumed')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('ProvingError includes statusCode', () => {
    const err = new ProvingError({ message: 'WASM out of memory', statusCode: 500 })
    expect(err.name).toBe('ProvingError')
    expect(err.statusCode).toBe(500)
    expect(err.message).toContain('WASM out of memory')
    expect(err.message).toContain('500')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('SimulateNotSupportedError has actionable message', () => {
    const err = new SimulateNotSupportedError()
    expect(err.name).toBe('SimulateNotSupportedError')
    expect(err.message).toContain('RPC')
    expect(err.message).toContain('executeContract')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('cause chain is preserved', () => {
    const cause = new Error('underlying SDK error')
    const err = new InvalidTransactionError('bad tx', { cause })
    expect(err.cause).toBe(cause)
  })
})

describe('classifyBroadcastError', () => {
  it('classifies "already exists" as DuplicateTransactionError', () => {
    const raw = new Error("Transaction 'at1abc' already exists in the ledger")
    const err = classifyBroadcastError(raw, 'at1abc')
    expect(err).toBeInstanceOf(DuplicateTransactionError)
    expect((err as DuplicateTransactionError).transactionId).toBe('at1abc')
    expect(err.cause).toBe(raw)
  })

  it('classifies "duplicate Output ID" as OutputIdCollisionError', () => {
    const raw = new Error('Found a duplicate Output ID in the transaction')
    const err = classifyBroadcastError(raw)
    expect(err).toBeInstanceOf(OutputIdCollisionError)
  })

  it('classifies "duplicate serial_number" as RecordSpentError', () => {
    const raw = new Error('Found a duplicate serial_number in the transaction')
    const err = classifyBroadcastError(raw)
    expect(err).toBeInstanceOf(RecordSpentError)
  })

  it('classifies "duplicate commitment" as OutputIdCollisionError', () => {
    const raw = new Error('Found a duplicate commitment in the transaction')
    const err = classifyBroadcastError(raw)
    expect(err).toBeInstanceOf(OutputIdCollisionError)
  })

  it('classifies "Invalid transaction" as InvalidTransactionError', () => {
    const raw = new Error('Invalid transaction — Fee verification failed: insufficient balance')
    const err = classifyBroadcastError(raw)
    expect(err).toBeInstanceOf(InvalidTransactionError)
  })

  it('classifies "not well-formed" as InvalidTransactionError', () => {
    const raw = new Error("Transaction 'at1abc' is not well-formed: bad inputs")
    const err = classifyBroadcastError(raw)
    expect(err).toBeInstanceOf(InvalidTransactionError)
  })

  it('classifies HTTP 400 as InvalidTransactionError', () => {
    const raw = Object.assign(new Error('some message'), { status: 400 })
    const err = classifyBroadcastError(raw)
    expect(err).toBeInstanceOf(InvalidTransactionError)
  })

  it('classifies HTTP 422 as InvalidTransactionError', () => {
    const raw = Object.assign(new Error('some message'), { status: 422 })
    const err = classifyBroadcastError(raw)
    expect(err).toBeInstanceOf(InvalidTransactionError)
  })

  it('falls back to BroadcastError for unrecognized messages', () => {
    const raw = new Error('something unexpected happened')
    const err = classifyBroadcastError(raw)
    expect(err).toBeInstanceOf(BroadcastError)
    expect(err.cause).toBe(raw)
  })

  it('BroadcastError captures HTTP 503 status', () => {
    const raw = Object.assign(new Error('service unavailable'), { status: 503 })
    const err = classifyBroadcastError(raw)
    expect(err).toBeInstanceOf(BroadcastError)
    expect((err as BroadcastError).statusCode).toBe(503)
  })
})

describe('classifyProvingError', () => {
  it('classifies generic proving failure as ProvingError', () => {
    const raw = new Error('WASM execution failed: out of memory')
    const err = classifyProvingError(raw)
    expect(err).toBeInstanceOf(ProvingError)
    expect(err.cause).toBe(raw)
  })

  it('delegates broadcast-like messages to classifyBroadcastError', () => {
    const raw = new Error("Transaction 'at1abc' already exists in the ledger")
    const err = classifyProvingError(raw)
    expect(err).toBeInstanceOf(DuplicateTransactionError)
  })

  it('delegates "Invalid transaction" to classifyBroadcastError', () => {
    const raw = new Error('Invalid transaction — bad proof')
    const err = classifyProvingError(raw)
    expect(err).toBeInstanceOf(InvalidTransactionError)
  })

  it('preserves HTTP status on ProvingError', () => {
    const raw = Object.assign(new Error('prover service down'), { status: 500 })
    const err = classifyProvingError(raw)
    expect(err).toBeInstanceOf(ProvingError)
    expect((err as ProvingError).statusCode).toBe(500)
  })
})
