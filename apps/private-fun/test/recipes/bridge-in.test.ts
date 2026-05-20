import { describe, it, expect, vi } from 'vitest'
import { bridgeIn } from '../../src/lib/recipes/bridge-in.js'
import type { BridgeClient } from '@veil/bridge'

function makeBridge(): BridgeClient {
  const client = {
    request: vi.fn(),
    getQuotes: vi.fn().mockResolvedValue({
      quotes: [{
        provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
        quoteId: 'q1',
        srcChain: 'solana',
        destChain: 'aleo',
        srcAsset: 'SOL',
        destAsset: 'WSOL',
        amountIn: '0.5',
        amountOut: '0.49',
      }],
      meta: { count: 1, quoteRequestId: 'req-1' },
    }),
    createOrder: vi.fn().mockResolvedValue({
      orderId: 'o1',
      depositAddress: '8xJ_bridge_deposit',
      depositAmount: '500000000',
      depositChain: 'solana',
      instructions: {
        type: 'ONCHAIN_DEPOSIT',
        address: '8xJ_bridge_deposit',
        amount: '500000000',
        chain: 'solana',
      },
    }),
    waitForOrder: vi.fn().mockResolvedValue({
      orderId: 'o1',
      provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
      status: 'COMPLETED',
      timeline: [],
      createdAt: '2026-05-19T00:00:00Z',
      updatedAt: '2026-05-19T00:00:00Z',
    }),
  }
  return client as unknown as BridgeClient
}

describe('bridgeIn', () => {
  it('returns quote + instructions for the caller to deposit + wait helper', async () => {
    const bridge = makeBridge()
    const result = await bridgeIn({
      bridge,
      source: { chain: 'solana', asset: 'SOL', address: '8xJ_sender', amount: '0.5' },
      destinationAsset: 'WSOL',
      recipientAleoAddress: 'aleo1recipient',
    })

    expect(result.quote.quoteId).toBe('q1')
    expect(result.instructions.depositAddress).toBe('8xJ_bridge_deposit')
    expect(typeof result.waitForCompletion).toBe('function')

    expect(bridge.getQuotes).toHaveBeenCalledWith(expect.objectContaining({
      srcChain: 'solana',
      srcAsset: 'SOL',
      destChain: 'aleo',
      destAsset: 'WSOL',
      amountIn: '0.5',
      recipientAddress: 'aleo1recipient',
    }))
    expect(bridge.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'p1',
      quoteId: 'q1',
      srcChain: 'solana',
      destChain: 'aleo',
      srcAsset: 'SOL',
      destAsset: 'WSOL',
      amountIn: '0.5',
      walletAddress: '8xJ_sender',
    }))
  })

  it('waitForCompletion calls bridge.waitForOrder with the order id', async () => {
    const bridge = makeBridge()
    const result = await bridgeIn({
      bridge,
      source: { chain: 'solana', asset: 'SOL', address: '8xJ_sender', amount: '0.5' },
      destinationAsset: 'WSOL',
      recipientAleoAddress: 'aleo1recipient',
    })

    const status = await result.waitForCompletion()
    expect(status.status).toBe('COMPLETED')
    expect(bridge.waitForOrder).toHaveBeenCalledWith(expect.objectContaining({
      id: 'o1',
      until: 'COMPLETED',
    }))
  })

  it('throws if no quotes are returned', async () => {
    const bridge = makeBridge()
    ;(bridge.getQuotes as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      quotes: [],
      meta: { count: 0, quoteRequestId: 'req' },
    })

    await expect(bridgeIn({
      bridge,
      source: { chain: 'ethereum', asset: 'USDC', address: '0xsender', amount: '100' },
      destinationAsset: 'WUSDC',
      recipientAleoAddress: 'aleo1recipient',
    })).rejects.toThrow(/no quotes/i)
  })
})
