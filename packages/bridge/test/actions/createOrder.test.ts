import { describe, it, expect, vi } from 'vitest'
import { createOrder } from '../../src/actions/createOrder.js'
import { BridgeEnvelopeError } from '../../src/errors/bridgeErrors.js'
import type { Client } from '@veil/core'

function makeClient(response: unknown): Client {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as Client
}

const baseParams = {
  providerId: 'p1',
  srcChain: 'aleo',
  destChain: 'solana',
  srcAsset: 'ALEO',
  destAsset: 'SOL',
  amountIn: '1.5',
  walletAddress: '8xJ...',
  quoteId: 'q1',
}

describe('createOrder', () => {
  it('returns BridgeOrderInstructions and passes params through to the request', async () => {
    const client = makeClient({
      data: {
        orderId: 'o1',
        depositAddress: 'aleo1deposit',
        depositAmount: '1.5',
        depositChain: 'aleo',
        instructions: {
          type: 'ONCHAIN_DEPOSIT',
          address: 'aleo1deposit',
          amount: '1.5',
          chain: 'aleo',
        },
      },
    })

    const result = await createOrder(client, baseParams)

    expect(result.orderId).toBe('o1')
    expect(result.depositAddress).toBe('aleo1deposit')
    expect((client.request as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      method: 'createBridgeOrder',
      params: baseParams,
    })
  })

  it('passes timezone through to the request params', async () => {
    const client = makeClient({
      data: {
        orderId: 'o1',
        depositAddress: 'a',
        depositAmount: '1',
        depositChain: 'aleo',
        instructions: { type: 'ONCHAIN_DEPOSIT', address: 'a', amount: '1', chain: 'aleo' },
      },
    })

    await createOrder(client, { ...baseParams, timezone: 'America/New_York' })

    expect((client.request as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      method: 'createBridgeOrder',
      params: { ...baseParams, timezone: 'America/New_York' },
    })
  })

  it('passes optional fields through when supplied', async () => {
    const client = makeClient({
      data: {
        orderId: 'o1',
        depositAddress: 'a',
        depositAmount: '1',
        depositChain: 'aleo',
        instructions: { type: 'ONCHAIN_DEPOSIT', address: 'a', amount: '1', chain: 'aleo' },
      },
    })

    await createOrder(client, {
      ...baseParams,
      integrationType: 'CEX',
      slippageBps: '50',
      refundAddress: 'aleo1refund',
    })

    expect((client.request as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      method: 'createBridgeOrder',
      params: {
        ...baseParams,
        integrationType: 'CEX',
        slippageBps: '50',
        refundAddress: 'aleo1refund',
      },
    })
  })

  it('throws BridgeEnvelopeError on missing data', async () => {
    const client = makeClient({})
    await expect(createOrder(client, baseParams)).rejects.toThrow(BridgeEnvelopeError)
  })
})
