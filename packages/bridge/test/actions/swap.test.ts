import { describe, it, expect, vi } from 'vitest'
import { swap } from '../../src/actions/swap.js'
import { BridgeError } from '../../src/errors/bridgeErrors.js'
import type { Client, WalletClient } from '@veil/core'

function makeQuote(over: Partial<Record<string, unknown>> = {}) {
  return {
    provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
    quoteId: 'q1',
    srcChain: 'aleo',
    destChain: 'solana',
    srcAsset: 'ALEO',
    destAsset: 'SOL',
    amountIn: '1.5',
    amountOut: '0.05',
    estimatedTimeSeconds: 120,
    ...over,
  }
}

function makeStatus(statusValue: string) {
  return {
    orderId: 'o1',
    provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
    status: statusValue,
    timeline: [],
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
  }
}

function makeBridgeClient(opts: {
  quotes: ReturnType<typeof makeQuote>[]
  meta?: { count: number; quoteRequestId: string }
  order?: unknown
  pollStages?: string[]
}): Client {
  let i = 0
  return {
    request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'getBridgeQuotes') {
        return {
          data: opts.quotes,
          meta: opts.meta ?? { count: opts.quotes.length, quoteRequestId: 'req-1' },
        }
      }
      if (method === 'createBridgeOrder') {
        return {
          data: opts.order ?? {
            orderId: 'o1',
            depositAddress: 'aleo1deposit',
            depositAmount: '1500000',
            depositChain: 'aleo',
            instructions: { type: 'ONCHAIN_DEPOSIT', address: 'aleo1deposit', amount: '1500000', chain: 'aleo' },
          },
        }
      }
      if (method === 'getBridgeOrder') {
        const stages = opts.pollStages ?? ['COMPLETED']
        return { data: makeStatus(stages[Math.min(i++, stages.length - 1)]) }
      }
      throw new Error(`unexpected method ${method}`)
    }),
  } as unknown as Client
}

function makeWallet(over: Partial<{ address: string; transactionId: string }> = {}): WalletClient {
  return {
    account: { address: over.address ?? 'aleo1sender' },
    executeContract: vi.fn().mockResolvedValue({
      transactionId: over.transactionId ?? 'at1deadbeef',
      transitions: [],
      outputs: [],
    }),
  } as unknown as WalletClient
}

const baseParams = {
  from: { asset: 'ALEO', amount: '1.5' },
  to: { chain: 'solana', asset: 'SOL', address: '8xJ...' },
  record: '{ owner: aleo1sender.private, amount: 5000000u64.private, _nonce: 0group.public }',
}

describe('swap', () => {
  it('runs quote → select(best=highest amountOut) → order → unshield → poll to COMPLETED', async () => {
    const bridge = makeBridgeClient({
      quotes: [makeQuote({ quoteId: 'a', amountOut: '0.04' }), makeQuote({ quoteId: 'b', amountOut: '0.05' })],
      pollStages: ['WAITING', 'COMPLETED'],
    })
    const wallet = makeWallet()

    const result = await swap(bridge, {
      ...baseParams,
      wallet,
      selectQuote: 'best',
      poll: true,
    })

    expect(result.orderId).toBe('o1')
    expect(result.depositTxId).toBe('at1deadbeef')
    expect(result.finalStatus?.status).toBe('COMPLETED')

    // Picked the higher-amountOut quote
    const requestMock = bridge.request as ReturnType<typeof vi.fn>
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      method: 'createBridgeOrder',
      params: expect.objectContaining({
        quoteId: 'b',
        providerId: 'p1',
        walletAddress: 'aleo1sender',
      }),
    }))

    // Wallet was asked to do transfer_private_to_public with the record + deposit address + u64 amount
    const executeMock = wallet.executeContract as unknown as ReturnType<typeof vi.fn>
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      program: 'credits.aleo',
      function: 'transfer_private_to_public',
      inputs: [baseParams.record, 'aleo1deposit', '1500000u64'],
    }))
  })

  it('selectQuote=fastest picks the lowest estimatedTimeSeconds', async () => {
    const bridge = makeBridgeClient({
      quotes: [
        makeQuote({ quoteId: 'slow', estimatedTimeSeconds: 600 }),
        makeQuote({ quoteId: 'fast', estimatedTimeSeconds: 60 }),
      ],
    })
    const wallet = makeWallet()

    await swap(bridge, { ...baseParams, wallet, selectQuote: 'fastest', poll: false })

    const requestMock = bridge.request as ReturnType<typeof vi.fn>
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      method: 'createBridgeOrder',
      params: expect.objectContaining({ quoteId: 'fast' }),
    }))
  })

  it('selectQuote callback can pick any quote', async () => {
    const bridge = makeBridgeClient({
      quotes: [makeQuote({ quoteId: 'a' }), makeQuote({ quoteId: 'b' })],
    })
    const wallet = makeWallet()

    await swap(bridge, {
      ...baseParams,
      wallet,
      selectQuote: (qs) => qs.find((q) => q.quoteId === 'a')!,
      poll: false,
    })

    const requestMock = bridge.request as ReturnType<typeof vi.fn>
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      method: 'createBridgeOrder',
      params: expect.objectContaining({ quoteId: 'a' }),
    }))
  })

  it('poll=false skips waitForOrder', async () => {
    const bridge = makeBridgeClient({ quotes: [makeQuote()] })
    const wallet = makeWallet()

    const result = await swap(bridge, { ...baseParams, wallet, poll: false })

    expect(result.finalStatus).toBeUndefined()
    const methods = ((bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].method))
    expect(methods).not.toContain('getBridgeOrder')
  })

  it('throws BridgeError when there are zero quotes', async () => {
    const bridge = makeBridgeClient({
      quotes: [],
      meta: { count: 0, quoteRequestId: 'req' },
    })
    const wallet = makeWallet()

    await expect(swap(bridge, { ...baseParams, wallet })).rejects.toThrow(/no quotes/i)
  })

  it('throws BridgeError when wallet has no account', async () => {
    const bridge = makeBridgeClient({ quotes: [makeQuote()] })
    const wallet = { executeContract: vi.fn() } as unknown as WalletClient

    await expect(swap(bridge, { ...baseParams, wallet })).rejects.toThrow(BridgeError)
  })
})
