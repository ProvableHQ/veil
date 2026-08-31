import { describe, expect, it, vi } from 'vitest'
import { BridgeError } from '../../src/errors/bridgeErrors.js'
import { createSolanaRpcReader } from '../../src/solana/rpc.js'
import type { SolanaRpcHttpTransport } from '../../src/types/solana.js'

function jsonResponse(body: unknown, status = 200): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function parseBody(init: { body: string }): { method: string; params: unknown[] } {
  const parsed = JSON.parse(init.body) as { method: string; params: unknown[] }
  return { method: parsed.method, params: parsed.params }
}

describe('createSolanaRpcReader', () => {
  it('getLatestBlockhash posts the right method and maps the result to a bigint height', async () => {
    const transport: SolanaRpcHttpTransport = vi.fn(async () =>
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { context: { slot: 1 }, value: { blockhash: 'abc123', lastValidBlockHeight: 123456789 } },
      }),
    )
    const reader = createSolanaRpcReader({ url: 'http://rpc.test', transport })
    const result = await reader.getLatestBlockhash()
    expect(result).toEqual({ blockhash: 'abc123', lastValidBlockHeight: 123456789n })
    const [, init] = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }]
    expect(parseBody(init).method).toBe('getLatestBlockhash')
  })

  it('getBalance posts the address and maps the result to a bigint', async () => {
    const transport: SolanaRpcHttpTransport = vi.fn(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: 1_000_000_000 } }),
    )
    const reader = createSolanaRpcReader({ url: 'http://rpc.test', transport })
    const balance = await reader.getBalance('SenderAddress111111111111111111111111111')
    expect(balance).toBe(1_000_000_000n)
    const [, init] = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }]
    const { method, params } = parseBody(init)
    expect(method).toBe('getBalance')
    expect(params).toEqual(['SenderAddress111111111111111111111111111'])
  })

  describe('getAccountData', () => {
    it('decodes base64 account data with getAccountInfo', async () => {
      const base64 = Buffer.from([1, 2, 3, 4]).toString('base64')
      const transport: SolanaRpcHttpTransport = vi.fn(async () =>
        jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: { context: { slot: 1 }, value: { data: [base64, 'base64'], owner: 'x', lamports: 1 } },
        }),
      )
      const reader = createSolanaRpcReader({ url: 'http://rpc.test', transport })
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
      const reader = createSolanaRpcReader({ url: 'http://rpc.test', transport })
      expect(await reader.getAccountData('MissingAccount11111111111111111111111111')).toBeNull()
    })
  })

  describe('getSignatureStatus', () => {
    it('returns null when the signature is unknown', async () => {
      const transport: SolanaRpcHttpTransport = vi.fn(async () =>
        jsonResponse({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: [null] } }),
      )
      const reader = createSolanaRpcReader({ url: 'http://rpc.test', transport })
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
      const reader = createSolanaRpcReader({ url: 'http://rpc.test', transport })
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
      const reader = createSolanaRpcReader({ url: 'http://rpc.test', transport })
      expect(await reader.getSignatureStatus('sig')).toBe('finalized')
      const [, init] = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }]
      const { method, params } = parseBody(init)
      expect(method).toBe('getSignatureStatuses')
      expect(params).toEqual([['sig']])
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
      const reader = createSolanaRpcReader({ url: 'http://rpc.test', transport })
      expect(await reader.getTransactionLogs('sig')).toEqual(['Program log: hi'])
      const [, init] = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }]
      const { method, params } = parseBody(init)
      expect(method).toBe('getTransaction')
      expect(params).toEqual(['sig', { maxSupportedTransactionVersion: 0 }])
    })

    it('returns null when the transaction is not found', async () => {
      const transport: SolanaRpcHttpTransport = vi.fn(async () =>
        jsonResponse({ jsonrpc: '2.0', id: 1, result: null }),
      )
      const reader = createSolanaRpcReader({ url: 'http://rpc.test', transport })
      expect(await reader.getTransactionLogs('sig')).toBeNull()
    })
  })

  it('throws a BridgeError carrying the status for a non-ok HTTP response', async () => {
    const transport: SolanaRpcHttpTransport = vi.fn(async () => jsonResponse({}, 500))
    const reader = createSolanaRpcReader({ url: 'http://rpc.test', transport })
    await expect(reader.getBalance('addr')).rejects.toThrow(BridgeError)
    await expect(reader.getBalance('addr')).rejects.toMatchObject({ message: expect.stringContaining('500') })
  })

  it('throws a BridgeError carrying the JSON-RPC error message', async () => {
    const transport: SolanaRpcHttpTransport = vi.fn(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid param' } }),
    )
    const reader = createSolanaRpcReader({ url: 'http://rpc.test', transport })
    await expect(reader.getBalance('addr')).rejects.toThrow(BridgeError)
    await expect(reader.getBalance('addr')).rejects.toMatchObject({ message: expect.stringContaining('Invalid param') })
  })
})
