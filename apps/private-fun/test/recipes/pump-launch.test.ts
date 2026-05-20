import { describe, it, expect, vi } from 'vitest'
import { pumpLaunch } from '../../src/lib/recipes/pump-launch.js'
import type { WalletClient } from '@veil/core'
import type { BridgeClient } from '@veil/bridge'

function makeBridge(): BridgeClient {
  return {
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
  } as unknown as BridgeClient
}

function makeAleoWallet(): WalletClient {
  return {
    account: { type: 'rpc', address: 'aleo1sender', sign: vi.fn() },
    request: vi.fn(),
  } as unknown as WalletClient
}

describe('pumpLaunch', () => {
  it('pins metadata → fund-out → launchWithCreator → returns structured result', async () => {
    const bridge = makeBridge()
    const wallet = makeAleoWallet()
    const pinMetadata = vi.fn().mockResolvedValue('ipfs://meta-cid')
    const launchWithCreator = vi.fn().mockResolvedValue({
      tokenMint: 'BvK_mint',
      solanaTxSignature: '5j2K_sig',
    })

    const result = await pumpLaunch({
      bridge,
      aleoWallet: wallet,
      creator: { publicKey: '8xJ_creator', signTransaction: vi.fn() },
      totalSol: '0.5',
      initialBuySol: '0.05',
      metadata: { name: 'DEMO', symbol: 'DEMO', imageUri: 'data:image/png;base64,xxx' },
      pinMetadata,
      launchWithCreator,
    })

    expect(pinMetadata).toHaveBeenCalledWith(expect.objectContaining({ name: 'DEMO' }))
    expect(bridge.swap).toHaveBeenCalledWith(expect.objectContaining({
      from: { asset: 'ALEO', amount: '0.5' },
      to: { chain: 'solana', asset: 'SOL', address: '8xJ_creator' },
      poll: 'COMPLETED',
    }))
    expect(launchWithCreator).toHaveBeenCalledWith(expect.objectContaining({
      creator: expect.objectContaining({ publicKey: '8xJ_creator' }),
      metadataUri: 'ipfs://meta-cid',
      initialBuySol: '0.05',
    }))
    expect(result).toEqual({
      tokenMint: 'BvK_mint',
      creatorAddress: '8xJ_creator',
      pumpfunUrl: 'https://pump.fun/coin/BvK_mint',
      bridgeOrderId: 'o1',
      solanaTxSignature: '5j2K_sig',
    })
  })
})
