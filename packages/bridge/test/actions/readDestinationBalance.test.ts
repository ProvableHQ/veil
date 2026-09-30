import { describe, expect, it, vi } from 'vitest'
import { prepare } from '../../src/actions/prepare.js'
import { readDestinationBalance } from '../../src/actions/internal/readDestinationBalance.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import type { BridgeChainClients } from '../../src/connections/resolve.js'

function tokenAccountData(amount: bigint): Uint8Array {
  const data = new Uint8Array(165)
  let remaining = amount
  for (let index = 0; index < 8; index++) {
    data[64 + index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return data
}

describe('readDestinationBalance', () => {
  it('reads an Aleo-to-Solana SPL recipient through its associated token account', async () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'aleo', asset: 'zec' },
      destination: { chain: 'solana', asset: 'zec' },
      bridgeProtocol: 'hyperlane',
      amount: '0.0001',
      recipient: 'D4jZ2sNktKgTrhWVMnjZb5BXP7MMh9N3y5ZLwkyKfozb',
    })
    const getAccountData = vi.fn(async () => tokenAccountData(166_575n))
    const clients = {
      solana: {
        family: 'solana',
        publicClient: { getAccountData },
      },
    } as unknown as BridgeChainClients

    await expect(readDestinationBalance(DEFAULT_BRIDGE_REGISTRY, clients, plan)).resolves.toBe(166_575n)
    expect(getAccountData).toHaveBeenCalledWith('FPAwNBT635S69zX3d8XLFDRBin4yHfVRkPhAvZN1kQ2K')
  })

  it('treats an uncreated recipient token account as a zero balance', async () => {
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'aleo', asset: 'zec' },
      destination: { chain: 'solana', asset: 'zec' },
      bridgeProtocol: 'hyperlane',
      amount: '0.0001',
      recipient: '11111111111111111111111111111111',
    })
    const clients = {
      solana: {
        family: 'solana',
        publicClient: { getAccountData: async () => null },
      },
    } as unknown as BridgeChainClients

    await expect(readDestinationBalance(DEFAULT_BRIDGE_REGISTRY, clients, plan)).resolves.toBe(0n)
  })
})
