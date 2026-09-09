import { describe, expect, it, vi } from 'vitest'
import { BridgeError } from '../../src/errors/bridgeErrors.js'
import { createSolanaRpcClient } from '../../src/solana/rpc.js'
import type { SolanaRpcHttpTransport } from '../../src/types/solana.js'

function jsonResponse(body: unknown, status = 200): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function parseBody(init: { body: string }): { method: string; params: unknown[] } {
  const parsed = JSON.parse(init.body) as { method: string; params: unknown[] }
  return { method: parsed.method, params: parsed.params }
}

describe('createSolanaRpcClient', () => {
  it('reads block height, message fee, and rent as bigint values', async () => {
    const transport: SolanaRpcHttpTransport = vi.fn(async (_url, init) => {
      const { method } = parseBody(init)
      if (method === 'getBlockHeight') return jsonResponse({ result: 42 })
      if (method === 'getFeeForMessage') return jsonResponse({ result: { context: { slot: 1 }, value: 10_000 } })
      return jsonResponse({ result: 890_880 })
    })
    const reader = createSolanaRpcClient({ url: 'http://rpc.test', transport })
    expect(await reader.getBlockHeight()).toBe(42n)
    expect(await reader.getFeeForMessage(new Uint8Array([1, 2, 3]))).toBe(10_000n)
    expect(await reader.getMinimumBalanceForRentExemption(0)).toBe(890_880n)
  })

  it('requests signature history and rejects malformed integer results', async () => {
    const transport: SolanaRpcHttpTransport = vi.fn(async (_url, init) => {
      const { method } = parseBody(init)
      if (method === 'getSignatureStatuses') return jsonResponse({ result: { context: { slot: 1 }, value: [null] } })
      return jsonResponse({ result: { context: { slot: 1 }, value: -1 } })
    })
    const reader = createSolanaRpcClient({ url: 'http://rpc.test', transport })
    await reader.getSignatureStatus('sig')
    const [, statusInit] = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }]
    expect(parseBody(statusInit).params).toEqual([['sig'], { searchTransactionHistory: true }])
    await expect(reader.getBalance('addr')).rejects.toThrow(/getBalance returned an invalid result/)
  })

  it('getLatestBlockhash posts the right method and maps the result to a bigint height', async () => {
    const transport: SolanaRpcHttpTransport = vi.fn(async () =>
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { context: { slot: 1 }, value: { blockhash: 'abc123', lastValidBlockHeight: 123456789 } },
      }),
    )
    const reader = createSolanaRpcClient({ url: 'http://rpc.test', transport })
    const result = await reader.getLatestBlockhash()
    expect(result).toEqual({ blockhash: 'abc123', lastValidBlockHeight: 123456789n })
    const [, init] = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }]
    expect(parseBody(init).method).toBe('getLatestBlockhash')
  })

  it('getBalance posts the address and maps the result to a bigint', async () => {
    const transport: SolanaRpcHttpTransport = vi.fn(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: 1_000_000_000 } }),
    )
    const reader = createSolanaRpcClient({ url: 'http://rpc.test', transport })
    const balance = await reader.getBalance('SenderAddress111111111111111111111111111')
    expect(balance).toBe(1_000_000_000n)
    const [, init] = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }]
    const { method, params } = parseBody(init)
    expect(method).toBe('getBalance')
    expect(params).toEqual(['SenderAddress111111111111111111111111111'])
  })

  describe('getAccountData', () => {
    it('rejects account data that is not declared as base64', async () => {
      const transport: SolanaRpcHttpTransport = vi.fn(async () => jsonResponse({
        result: { context: { slot: 1 }, value: { data: ['abc', 'base58'] } },
      }))
      await expect(createSolanaRpcClient({ url: 'http://rpc.test', transport }).getAccountData('addr'))
        .rejects.toThrow(/getAccountInfo returned invalid base64 account data/)
    })

    it('decodes base64 account data with getAccountInfo', async () => {
      const base64 = Buffer.from([1, 2, 3, 4]).toString('base64')
      const transport: SolanaRpcHttpTransport = vi.fn(async () =>
        jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: { context: { slot: 1 }, value: { data: [base64, 'base64'], owner: 'x', lamports: 1 } },
        }),
      )
      const reader = createSolanaRpcClient({ url: 'http://rpc.test', transport })
      const data = await reader.getAccountData('AccountAddress1111111111111111111111111')
      expect(data).toEqual(new Uint8Array([1, 2, 3, 4]))
      const [, init] = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }]
      const { method, params } = parseBody(init)
      expect(method).toBe('getAccountInfo')
      expect(params).toEqual(['AccountAddress1111111111111111111111111', { encoding: 'base64' }])
    })

    it('returns null when the account does not exist', async () => {
      const transport: SolanaRpcHttpTransport = vi.fn(async () =>
        jsonResponse({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: null } }),
      )
      const reader = createSolanaRpcClient({ url: 'http://rpc.test', transport })
      expect(await reader.getAccountData('MissingAccount11111111111111111111111111')).toBeNull()
    })
  })

  describe('getSignatureStatus', () => {
    it('rejects unsupported confirmation statuses', async () => {
      const transport: SolanaRpcHttpTransport = vi.fn(async () => jsonResponse({
        result: { context: { slot: 1 }, value: [{ err: null, confirmationStatus: 'mystery' }] },
      }))
      await expect(createSolanaRpcClient({ url: 'http://rpc.test', transport }).getSignatureStatus('sig'))
        .rejects.toThrow(/unsupported confirmation status/)
    })

    it('returns null when the signature is unknown', async () => {
      const transport: SolanaRpcHttpTransport = vi.fn(async () =>
        jsonResponse({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: [null] } }),
      )
      const reader = createSolanaRpcClient({ url: 'http://rpc.test', transport })
      expect(await reader.getSignatureStatus('sig')).toBeNull()
    })

    it('maps a present err to failed', async () => {
      const transport: SolanaRpcHttpTransport = vi.fn(async () =>
        jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: { context: { slot: 1 }, value: [{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'processed' }] },
        }),
      )
      const reader = createSolanaRpcClient({ url: 'http://rpc.test', transport })
      expect(await reader.getSignatureStatus('sig')).toBe('failed')
    })

    it('passes through confirmationStatus when there is no error', async () => {
      const transport: SolanaRpcHttpTransport = vi.fn(async () =>
        jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: { context: { slot: 1 }, value: [{ err: null, confirmationStatus: 'finalized' }] },
        }),
      )
      const reader = createSolanaRpcClient({ url: 'http://rpc.test', transport })
      expect(await reader.getSignatureStatus('sig')).toBe('finalized')
      const [, init] = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }]
      const { method, params } = parseBody(init)
      expect(method).toBe('getSignatureStatuses')
      expect(params).toEqual([['sig'], { searchTransactionHistory: true }])
    })
  })

  describe('getTransactionLogs', () => {
    it('sends maxSupportedTransactionVersion: 0 and returns logMessages', async () => {
      const transport: SolanaRpcHttpTransport = vi.fn(async () =>
        jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: { meta: { logMessages: ['Program log: hi'] } },
        }),
      )
      const reader = createSolanaRpcClient({ url: 'http://rpc.test', transport })
      expect(await reader.getTransactionLogs('sig')).toEqual(['Program log: hi'])
      const [, init] = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }]
      const { method, params } = parseBody(init)
      expect(method).toBe('getTransaction')
      expect(params).toEqual(['sig', { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }])
    })

    it('returns null when the transaction is not found', async () => {
      const transport: SolanaRpcHttpTransport = vi.fn(async () =>
        jsonResponse({ jsonrpc: '2.0', id: 1, result: null }),
      )
      const reader = createSolanaRpcClient({ url: 'http://rpc.test', transport })
      expect(await reader.getTransactionLogs('sig')).toBeNull()
    })
  })

  it('throws a BridgeError carrying the status for a non-ok HTTP response', async () => {
    const transport: SolanaRpcHttpTransport = vi.fn(async () => jsonResponse({}, 500))
    const reader = createSolanaRpcClient({ url: 'http://rpc.test', transport })
    await expect(reader.getBalance('addr')).rejects.toThrow(BridgeError)
    await expect(reader.getBalance('addr')).rejects.toMatchObject({ message: expect.stringContaining('500') })
  })

  it('throws a BridgeError carrying the JSON-RPC error message', async () => {
    const transport: SolanaRpcHttpTransport = vi.fn(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid param' } }),
    )
    const reader = createSolanaRpcClient({ url: 'http://rpc.test', transport })
    await expect(reader.getBalance('addr')).rejects.toThrow(BridgeError)
    await expect(reader.getBalance('addr')).rejects.toMatchObject({ message: expect.stringContaining('Invalid param') })
  })

  it('wraps invalid JSON and rejects a missing result envelope', async () => {
    const invalidJson: SolanaRpcHttpTransport = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('bad json') },
    }))
    await expect(createSolanaRpcClient({ url: 'http://rpc.test', transport: invalidJson }).getBalance('addr'))
      .rejects.toMatchObject({ message: expect.stringContaining('invalid JSON') })

    const missingResult: SolanaRpcHttpTransport = vi.fn(async () => jsonResponse({ jsonrpc: '2.0', id: 1 }))
    await expect(createSolanaRpcClient({ url: 'http://rpc.test', transport: missingResult }).getBalance('addr'))
      .rejects.toMatchObject({ message: expect.stringContaining('invalid result envelope') })
  })

  it.each([
    ['getLatestBlockhash', (reader: ReturnType<typeof createSolanaRpcClient>) => reader.getLatestBlockhash(), {}],
    ['getBlockHeight', (reader: ReturnType<typeof createSolanaRpcClient>) => reader.getBlockHeight(), '1'],
    ['getBalance', (reader: ReturnType<typeof createSolanaRpcClient>) => reader.getBalance('addr'), { value: '1' }],
    ['getAccountInfo', (reader: ReturnType<typeof createSolanaRpcClient>) => reader.getAccountData('addr'), { value: { data: 'bad' } }],
    ['getFeeForMessage', (reader: ReturnType<typeof createSolanaRpcClient>) => reader.getFeeForMessage(new Uint8Array()), { value: null }],
    ['getMinimumBalanceForRentExemption', (reader: ReturnType<typeof createSolanaRpcClient>) => reader.getMinimumBalanceForRentExemption(0), -1],
    ['getSignatureStatuses', (reader: ReturnType<typeof createSolanaRpcClient>) => reader.getSignatureStatus('sig'), { value: [{}] }],
    ['getTransaction', (reader: ReturnType<typeof createSolanaRpcClient>) => reader.getTransactionLogs('sig'), { meta: {} }],
  ])('rejects malformed %s method results with BridgeError', async (_method, invoke, result) => {
    const transport: SolanaRpcHttpTransport = vi.fn(async () => jsonResponse({ result }))
    await expect(invoke(createSolanaRpcClient({ url: 'http://rpc.test', transport }))).rejects.toBeInstanceOf(BridgeError)
  })
})
