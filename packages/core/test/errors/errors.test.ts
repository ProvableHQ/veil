import { describe, it, expect, vi } from 'vitest'
import {
  AccountNotFoundError,
  InvalidAddressError,
  ProgramNotFoundError,
  InvalidInputError,
  ProvingNotConfiguredError,
  TransportError,
  BaseError,
} from '../../src/errors/errors.js'
import { writeContract } from '../../src/actions/wallet/writeContract.js'
import { deployContract } from '../../src/actions/wallet/deployContract.js'
import { signMessage } from '../../src/actions/wallet/signMessage.js'
import { decrypt } from '../../src/actions/wallet/decrypt.js'

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
})
