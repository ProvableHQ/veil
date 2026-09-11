import { describe, expect, it, vi } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { readHyperlaneDelivery } from '../../src/utils/hyperlaneDelivery.js'

const MESSAGE_ID = '0xc7c2c763ef846ff1583d9222d8ecbfc56da2e0cdcc9a63bc4bde51467644794d'
const ALEO_RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'

describe('readHyperlaneDelivery', () => {
  it('reads the canonical Aleo mailbox delivery keyed by the Hyperlane message id', async () => {
    const request = vi.fn(async () => '{ processor: aleo1processor, block_number: 21850301u32 }')

    const delivered = await readHyperlaneDelivery({
      family: 'aleo',
      publicClient: { request } as never,
    }, {
      messageId: MESSAGE_ID,
      mailbox: 'hyp_mailbox.aleo',
    })

    expect(delivered).toBe(true)
    expect(request).toHaveBeenCalledWith({
      method: 'getMappingValue',
      params: {
        programId: 'hyp_mailbox.aleo',
        mapping: 'deliveries',
        key: '{ id: [262854447642257427123071959211115528903u128, 102980212169860384794748804418278302317u128] }',
      },
    })
  })

  it('reads canonical EVM Mailbox delivery state', async () => {
    const delivered = await readHyperlaneDelivery({
      family: 'evm',
      publicClient: {
        call: vi.fn(async () => '0x0000000000000000000000000000000000000000000000000000000000000001'),
      } as never,
    }, {
      messageId: MESSAGE_ID,
      mailbox: '0xc005dc82818d67AF737725bD4bf75435d065D239',
    })

    expect(delivered).toBe(true)
  })

  it('keeps bridge progress pending until the destination mailbox records delivery', async () => {
    let reads = 0
    const bridge = createBridgeClient({
      environment: 'mainnet',
      clients: {
        aleo: {
          family: 'aleo',
          publicClient: {
            request: vi.fn(async () => ++reads === 1
              ? null
              : '{ processor: aleo1processor, block_number: 21850301u32 }'),
          } as never,
        },
      },
    })
    const plan = bridge.prepare({
      source: { chain: 'ethereum', asset: 'eth' },
      destination: { chain: 'aleo', asset: 'eth' },
      bridgeProtocol: 'hyperlane',
      amount: '0.000000000000000001',
      recipient: ALEO_RECIPIENT,
    })
    const receipt = {
      id: MESSAGE_ID,
      protocol: 'hyperlane' as const,
      status: 'DELIVERY_PENDING' as const,
      sourceTxId: `0x${'11'.repeat(32)}`,
      messageId: MESSAGE_ID,
      protocolState: { routeId: plan.route.id },
    }

    expect((await bridge.getStatus({ plan, receipt })).status).toBe('DELIVERY_PENDING')
    const completed = await bridge.wait({
      progress: { next: 'wait', plan, receipt },
      pollingIntervalMs: 0,
      timeoutMs: 1_000,
    })

    expect(completed).toMatchObject({ next: 'done', receipt: { status: 'COMPLETED' } })
  })

  it('keeps a Hyperlane receipt pending when source confirmation could not recover its message id', async () => {
    const bridge = createBridgeClient({ environment: 'mainnet' })
    const plan = bridge.prepare({
      source: { chain: 'ethereum', asset: 'eth' },
      destination: { chain: 'aleo', asset: 'eth' },
      bridgeProtocol: 'hyperlane',
      amount: '0.000000000000000001',
      recipient: ALEO_RECIPIENT,
    })
    const receipt = {
      id: `0x${'11'.repeat(32)}`,
      protocol: 'hyperlane' as const,
      status: 'DELIVERY_PENDING' as const,
      sourceTxId: `0x${'11'.repeat(32)}`,
      protocolState: { routeId: plan.route.id, messageIdUnavailable: true },
    }

    await expect(bridge.getStatus({ plan, receipt })).resolves.toBe(receipt)
  })
})
