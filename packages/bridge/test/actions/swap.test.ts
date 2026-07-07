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
      if (method === 'getBridgeAssets') {
        return {
          data: [
            { id: 'a1', code: 'ALEO_MAINNET', chain: 'ALEO', symbol: 'ALEO', decimals: 6, native: true },
            { id: 'a2', code: 'SOL_SOLANA', chain: 'SOLANA', symbol: 'SOL', decimals: 9, native: true },
          ],
        }
      }
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
        // payout recipient = destination address; the signer is the refund address
        walletAddress: '8xJ...',
        refundAddress: 'aleo1sender',
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

describe('swap (deposit instruction guards)', () => {
  it('throws without depositing when the order carries a deposit memo', async () => {
    const bridge = makeBridgeClient({
      quotes: [makeQuote()],
      order: {
        orderId: 'o1',
        depositAddress: 'aleo1deposit',
        depositAmount: '1.5',
        depositMemo: 'tag-123',
        depositChain: 'ALEO',
      },
    })
    const wallet = makeWallet()

    await expect(swap(bridge, { ...baseParams, wallet, poll: false })).rejects.toThrow(/memo/)
    // The Aleo deposit must NOT have been signed.
    const walletRequest = (wallet as unknown as { request: ReturnType<typeof vi.fn> }).request
    expect(walletRequest).not.toHaveBeenCalled()
  })

  it('prefers the decimals the order instructions declare over the asset map', async () => {
    const bridge = makeBridgeClient({
      quotes: [makeQuote()],
      order: {
        orderId: 'o1',
        depositAddress: 'aleo1deposit',
        depositAmount: '1.5',
        depositChain: 'ALEO',
        // The API is authoritative: 3 decimals here, though the map says 6.
        instructions: { type: 'ONCHAIN_DEPOSIT', address: 'aleo1deposit', amount: '1.5', chain: 'ALEO', assetDecimals: 3 },
      },
    })
    const wallet = makeWallet()

    await swap(bridge, { ...baseParams, wallet, poll: false })

    const walletRequest = (wallet as unknown as { request: ReturnType<typeof vi.fn> }).request
    expect(walletRequest).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        inputs: ['aleo1deposit', '1500u64'],
      }),
    })
  })

  it('validates the asset map and merkle requirement before any network call', async () => {
    const bridge = makeBridgeClient({ quotes: [makeQuote()] })
    const wallet = makeWallet()

    await expect(swap(bridge, {
      from: { asset: 'NOT_AN_ASSET', amount: '1' },
      to: { chain: 'SOLANA', asset: 'SOL_SOLANA', address: '8xJ...' },
      wallet,
    })).rejects.toThrow(/unknown aleo asset/i)
    // Failed on local validation — no quote request was issued.
    expect(bridge.request).not.toHaveBeenCalled()
  })
})

describe('swap (destination chain and refund address)', () => {
  it('accepts the destination chain by display name and sends the identifier', async () => {
    const bridge = makeBridgeClient({ quotes: [makeQuote()] })
    const wallet = makeWallet()

    await swap(bridge, {
      from: { asset: 'ALEO_MAINNET', amount: '1.5' },
      to: { chain: 'Solana', asset: 'SOL_SOLANA', address: '8xJ...' },
      wallet,
      poll: false,
    })

    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'getBridgeQuotes',
      params: expect.objectContaining({ destChain: 'SOLANA' }),
    }))
    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'createBridgeOrder',
      params: expect.objectContaining({ destChain: 'SOLANA' }),
    }))
  })

  it('refundAddress overrides the signer default on quote and order', async () => {
    const bridge = makeBridgeClient({ quotes: [makeQuote()] })
    const wallet = makeWallet()

    await swap(bridge, {
      ...baseParams,
      wallet,
      refundAddress: 'aleo1refund',
      poll: false,
    })

    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'getBridgeQuotes',
      params: expect.objectContaining({ refundAddress: 'aleo1refund' }),
    }))
    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'createBridgeOrder',
      params: expect.objectContaining({ refundAddress: 'aleo1refund' }),
    }))
  })
})

describe('swap (provider pinning)', () => {
  it('restricts the pick to the requested provider even when another quotes better', async () => {
    const bridge = makeBridgeClient({
      quotes: [
        makeQuote({ quoteId: 'best-other', amountOut: '0.09', provider: { id: 'p1', code: 'NEAR_INTENTS', displayName: 'NEAR', capabilities: [] } }),
        makeQuote({ quoteId: 'pinned', amountOut: '0.05', provider: { id: 'p2', code: 'HALLIDAY', displayName: 'Halliday', capabilities: [] } }),
      ],
    })
    const wallet = makeWallet()

    await swap(bridge, { ...baseParams, wallet, provider: 'halliday', poll: false })

    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'createBridgeOrder',
      params: expect.objectContaining({ quoteId: 'pinned', providerId: 'p2' }),
    }))
  })

  it('throws before any funds move when the pinned provider did not quote', async () => {
    const bridge = makeBridgeClient({
      quotes: [makeQuote({ provider: { id: 'p1', code: 'NEAR_INTENTS', displayName: 'NEAR', capabilities: [] } })],
    })
    const wallet = makeWallet()

    await expect(
      swap(bridge, { ...baseParams, wallet, provider: 'HOUDINI' }),
    ).rejects.toThrow(/HOUDINI.*no quote.*NEAR_INTENTS/s)
    // No order was created and no deposit signed.
    const methods = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].method)
    expect(methods).not.toContain('createBridgeOrder')
    const walletRequest = (wallet as unknown as { request: ReturnType<typeof vi.fn> }).request
    expect(walletRequest).not.toHaveBeenCalled()
  })
})

describe('swap (source chain slot)', () => {
  it("accepts from.chain as 'ALEO' or the display name 'Aleo'", async () => {
    for (const chain of ['ALEO', 'Aleo', 'aleo']) {
      const bridge = makeBridgeClient({ quotes: [makeQuote()] })
      const wallet = makeWallet()
      await swap(bridge, {
        from: { chain, asset: 'ALEO_MAINNET', amount: '1.5' },
        to: { chain: 'SOLANA', asset: 'SOL_SOLANA', address: '8xJ...' },
        wallet,
        poll: false,
      })
      expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({
        method: 'getBridgeQuotes',
        params: expect.objectContaining({ srcChain: 'ALEO' }),
      }))
    }
  })

  it('rejects a non-Aleo source chain before any network call', async () => {
    const bridge = makeBridgeClient({ quotes: [makeQuote()] })
    const wallet = makeWallet()

    await expect(swap(bridge, {
      from: { chain: 'Solana', asset: 'SOL_SOLANA', amount: '1' },
      to: { chain: 'ALEO', asset: 'ALEO_MAINNET', address: 'aleo1dest' },
      wallet,
    })).rejects.toThrow(/only source from Aleo.*getQuotes/s)
    expect(bridge.request).not.toHaveBeenCalled()
  })
})

describe('swap (symbol resolution)', () => {
  it('accepts symbols for both assets and sends resolved codes', async () => {
    const bridge = makeBridgeClient({ quotes: [makeQuote()] })
    const wallet = makeWallet()

    await swap(bridge, {
      from: { asset: 'ALEO', amount: '1.5' },          // symbol
      to: { chain: 'Solana', asset: 'SOL', address: '8xJ...' }, // name + symbol
      wallet,
      poll: false,
    })

    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'getBridgeQuotes',
      params: expect.objectContaining({ srcAsset: 'ALEO_MAINNET', destAsset: 'SOL_SOLANA' }),
    }))
    // The resolved code drives the deposit program too (credits.aleo, u64).
    const walletRequest = (wallet as unknown as { request: ReturnType<typeof vi.fn> }).request
    expect(walletRequest).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({ programName: 'credits.aleo' }),
    })
  })
})
