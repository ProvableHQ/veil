import { describe, it, expect, vi } from 'vitest'
import { swap } from '../../src/actions/swap.js'
import { BridgeError } from '../../src/errors/bridgeErrors.js'
import type { Client, WalletClient } from '@veil/core'

function makeQuote(over: Partial<Record<string, unknown>> = {}) {
  return {
    provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
    quoteId: 'q1',
    srcChain: 'ALEO',
    destChain: 'SOLANA',
    srcAsset: 'ALEO_MAINNET',
    destAsset: 'SOL_SOLANA',
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
    createdAt: '2026-05-19T00:00:00Z',
    updatedAt: '2026-05-19T00:00:00Z',
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
            depositAmount: '1.5',
            depositChain: 'ALEO',
            instructions: { type: 'ONCHAIN_DEPOSIT', address: 'aleo1deposit', amount: '1.5', chain: 'ALEO' },
          },
        }
      }
      if (method === 'getBridgeOrder') {
        const stages = opts.pollStages ?? ['COMPLETED']
        return { data: makeStatus(stages[Math.min(i++, stages.length - 1)] as string) }
      }
      throw new Error(`unexpected method ${method}`)
    }),
  } as unknown as Client
}

function makeWallet(over: Partial<{ address: string; transactionId: string }> = {}): WalletClient {
  const txId = over.transactionId ?? 'at1deadbeef'
  return {
    account: { type: 'rpc', address: over.address ?? 'aleo1sender', sign: vi.fn() },
    request: vi.fn().mockResolvedValue(txId),
  } as unknown as WalletClient
}

const baseParams = {
  from: { asset: 'ALEO_MAINNET', amount: '1.5' },
  to: { chain: 'SOLANA', asset: 'SOL_SOLANA', address: '8xJ...' },
}

describe('swap (ALEO source)', () => {
  it('runs quote → select(best) → order → unshield via credits.aleo → poll to COMPLETED', async () => {
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

    // Quote request used the API's chain identifier and included the signer's
    // refund address (providers skip quoting without it).
    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'getBridgeQuotes',
      params: expect.objectContaining({
        srcChain: 'ALEO',
        refundAddress: 'aleo1sender',
        recipientAddress: '8xJ...',
      }),
    }))

    // Picked the higher-amountOut quote
    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'createBridgeOrder',
      params: expect.objectContaining({
        quoteId: 'b',
        providerId: 'p1',
        walletAddress: 'aleo1sender',
      }),
    }))

    // Wallet's writeContract was asked to do transfer_private_to_public on credits.aleo, u64 amount
    const walletRequest = (wallet as unknown as { request: ReturnType<typeof vi.fn> }).request
    expect(walletRequest).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'credits.aleo',
        functionName: 'transfer_private_to_public',
        inputs: ['aleo1deposit', '1500000u64'],
        privateFee: true,
      }),
    })
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

    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({
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

    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({
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
    const wallet = { request: vi.fn() } as unknown as WalletClient

    await expect(swap(bridge, { ...baseParams, wallet })).rejects.toThrow(BridgeError)
  })
})

describe('swap (token_registry source — WBTC)', () => {
  it('routes deposit through token_registry.aleo with u128 amount', async () => {
    const bridge = makeBridgeClient({
      quotes: [makeQuote({ srcAsset: 'WBTC_ALEO' })],
      order: {
        orderId: 'o1',
        depositAddress: 'aleo1deposit',
        depositAmount: '0.01',
        depositChain: 'ALEO',
      },
    })
    const wallet = makeWallet()

    await swap(bridge, {
      from: { asset: 'WBTC_ALEO', amount: '0.01' },
      to: { chain: 'EVM:1', asset: 'WBTC_ETH', address: '0xdest' },
      wallet,
      poll: false,
    })

    const walletRequest = (wallet as unknown as { request: ReturnType<typeof vi.fn> }).request
    expect(walletRequest).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'token_registry.aleo',
        functionName: 'transfer_private_to_public',
        inputs: ['aleo1deposit', '1000000u128'],
        privateFee: true,
      }),
    })
  })
})

describe('swap (compliance source — USDCX)', () => {
  it('routes deposit through usdcx_stablecoin.aleo and appends merkleProof', async () => {
    const bridge = makeBridgeClient({
      quotes: [makeQuote({ srcAsset: 'USDCX_ALEO' })],
      order: {
        orderId: 'o1',
        depositAddress: 'aleo1deposit',
        depositAmount: '100',
        depositChain: 'ALEO',
      },
    })
    const wallet = makeWallet()

    await swap(bridge, {
      from: { asset: 'USDCX_ALEO', amount: '100' },
      to: { chain: 'EVM:1', asset: 'USDC_ETH', address: '0xdest' },
      wallet,
      merkleProof: 'mp-input',
      poll: false,
    })

    const walletRequest = (wallet as unknown as { request: ReturnType<typeof vi.fn> }).request
    expect(walletRequest).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'usdcx_stablecoin.aleo',
        functionName: 'transfer_private_to_public',
        inputs: ['aleo1deposit', '100000000u128', 'mp-input'],
        privateFee: true,
      }),
    })
  })

  it('throws BridgeError when merkleProof is missing for USDCX', async () => {
    const bridge = makeBridgeClient({
      quotes: [makeQuote({ srcAsset: 'USDCX_ALEO' })],
    })
    const wallet = makeWallet()

    await expect(swap(bridge, {
      from: { asset: 'USDCX_ALEO', amount: '100' },
      to: { chain: 'EVM:1', asset: 'USDC_ETH', address: '0xdest' },
      wallet,
    })).rejects.toThrow(/merkleProof/)
  })
})
