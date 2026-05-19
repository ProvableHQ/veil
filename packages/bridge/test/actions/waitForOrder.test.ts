import { describe, it, expect, vi } from 'vitest'
import { waitForOrder } from '../../src/actions/waitForOrder.js'
import { BridgeTimeoutError, BridgeOrderFailedError } from '../../src/errors/bridgeErrors.js'
import type { Client } from '@veil/core'

function makeStatus(statusValue: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    orderId: 'o1',
    provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
    status: statusValue,
    timeline: [],
    createdAt: '2026-05-18T00:00:00Z',
    updatedAt: '2026-05-18T00:00:00Z',
    ...over,
  }
}

function makeClient(stages: string[]): Client {
  let i = 0
  return {
    request: vi.fn().mockImplementation(async () => ({
      data: makeStatus(stages[Math.min(i++, stages.length - 1)]),
    })),
  } as unknown as Client
}

describe('waitForOrder', () => {
  it('resolves when status reaches the default terminal COMPLETED', async () => {
    const client = makeClient(['WAITING', 'CONFIRMING', 'COMPLETED'])
    const observed: string[] = []

    const result = await waitForOrder(client, {
      id: 'o1',
      pollIntervalMs: 1,
      timeoutMs: 1000,
      onStage: (s) => observed.push(s.status),
    })

    expect(result.status).toBe('COMPLETED')
    expect(observed).toEqual(['WAITING', 'CONFIRMING', 'COMPLETED'])
  })

  it('resolves when status reaches a custom non-terminal stage', async () => {
    const client = makeClient(['WAITING', 'CONFIRMING'])

    const result = await waitForOrder(client, {
      id: 'o1',
      until: 'CONFIRMING',
      pollIntervalMs: 1,
      timeoutMs: 1000,
    })

    expect(result.status).toBe('CONFIRMING')
  })

  it('throws BridgeOrderFailedError on terminal failure stage', async () => {
    const client = makeClient(['WAITING', 'FAILED'])

    await expect(
      waitForOrder(client, { id: 'o1', pollIntervalMs: 1, timeoutMs: 1000 }),
    ).rejects.toThrow(BridgeOrderFailedError)
  })

  it('includes finalStatus.reason.message in the failure error', async () => {
    const requestFn = vi.fn().mockImplementationOnce(async () => ({
      data: makeStatus('FAILED', {
        finalStatus: {
          key: 'FAILED',
          status: 'FAILED',
          reason: { code: 'TIMEOUT', message: 'provider gave up', source: 'provider' },
        },
      }),
    }))
    const client = { request: requestFn } as unknown as Client

    await expect(
      waitForOrder(client, { id: 'o1', pollIntervalMs: 1, timeoutMs: 1000 }),
    ).rejects.toThrow(/provider gave up/)
  })

  it('throws BridgeTimeoutError if the target stage is never reached', async () => {
    const client = makeClient(['WAITING'])

    await expect(
      waitForOrder(client, { id: 'o1', pollIntervalMs: 1, timeoutMs: 10 }),
    ).rejects.toThrow(BridgeTimeoutError)
  })

  it('returns the status as-is if any other terminal stage is reached without matching `until`', async () => {
    // E.g. user asked to wait for 'CONFIRMING' but order went straight to 'COMPLETED'
    const client = makeClient(['COMPLETED'])

    const result = await waitForOrder(client, {
      id: 'o1',
      until: 'CONFIRMING',
      pollIntervalMs: 1,
      timeoutMs: 1000,
    })

    expect(result.status).toBe('COMPLETED')
  })
})
