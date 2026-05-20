import { describe, it, expect, vi } from 'vitest'
import { fundOut } from '../../src/lib/recipes/fund-out.js'
import type { WalletClient } from '@veil/core'
import type { BridgeClient } from '@veil/bridge'

function makeBridge(): BridgeClient {
  const client = {
    request: vi.fn(),
    swap: vi.fn().mockResolvedValue({
      quoteRequestId: 'req-1',
      orderId: 'o1',
      depositTxId: 'at1deadbeef',
      finalStatus: {
        orderId: 'o1',
        provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
        status: 'COMPLETED',
        timeline: [],
        createdAt: '2026-05-19T00:00:00Z',
        updatedAt: '2026-05-19T00:00:00Z',
      },
    }),
  }
  return client as unknown as BridgeClient
}

function makeWallet(): WalletClient {
  return {
    account: { type: 'rpc', address: 'aleo1sender', sign: vi.fn() },
    request: vi.fn(),
  } as unknown as WalletClient
}

describe('fundOut', () => {
  it('delegates to bridge.swap with the destination chain/asset/address translated correctly', async () => {
    const bridge = makeBridge()
    const wallet = makeWallet()

    const result = await fundOut({
      bridge,
      aleoWallet: wallet,
      destination: { chain: 'solana', asset: 'SOL', address: '8xJ...', amount: '1.5' },
      sourceAsset: 'ALEO',
    })

    expect(result.orderId).toBe('o1')
    expect(result.depositTxId).toBe('at1deadbeef')

    expect(bridge.swap).toHaveBeenCalledWith(expect.objectContaining({
      wallet,
      from: { asset: 'ALEO', amount: '1.5' },
      to: { chain: 'solana', asset: 'SOL', address: '8xJ...' },
    }))
  })

  it('passes through selectQuote, merkleProof, and poll options', async () => {
    const bridge = makeBridge()
    const wallet = makeWallet()
    const selectQuote = vi.fn()
    const onStage = vi.fn()

    await fundOut({
      bridge,
      aleoWallet: wallet,
      destination: { chain: 'ethereum', asset: 'USDC', address: '0xdest', amount: '100' },
      sourceAsset: 'USDCX',
      merkleProof: 'mp-input',
      selectQuote,
      poll: 'COMPLETED',
      onStage,
    })

    expect(bridge.swap).toHaveBeenCalledWith(expect.objectContaining({
      from: { asset: 'USDCX', amount: '100' },
      to: { chain: 'ethereum', asset: 'USDC', address: '0xdest' },
      merkleProof: 'mp-input',
      selectQuote,
      poll: 'COMPLETED',
      onStage,
    }))
  })
})
