import { describe, expect, it, vi } from 'vitest'
import { followRoundtripLeg } from '../../examples/roundtrip-lifecycle.js'
import type { BridgeCheckpoint, BridgeClient, BridgePlan } from '../../src/index.js'

const plan = { protocol: 'cctp' } as BridgePlan
const checkpoint = { version: 1 } as BridgeCheckpoint
const pending = { next: 'wait', plan, receipt: { status: 'SOURCE_CONFIRMING' } }
const done = { ...pending, next: 'done', receipt: { status: 'COMPLETED' } }

describe('roundtrip recovery', () => {
  it('recovers a checkpoint emitted before an interrupted execute without executing again', async () => {
    let saved: BridgeCheckpoint | undefined
    const execute = vi.fn(async (params) => {
      params.onCheckpoint(checkpoint)
      throw new Error('Disconnected after submission')
    })
    const bridge = { execute, recover: vi.fn(async () => pending), wait: vi.fn(async () => done) } as unknown as BridgeClient
    await expect(followRoundtripLeg(bridge, { plan, persist: value => { saved = value } })).rejects.toThrow('Disconnected')
    expect(saved).toBe(checkpoint)
    const result = await followRoundtripLeg(bridge, { checkpoint: saved, persist: () => {} })
    expect(result.next).toBe('done')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('resumes a confirmed approval without repeating execute', async () => {
    const execute = vi.fn()
    const resume = vi.fn(async () => ({ receipt: pending.receipt }))
    const bridge = { execute, recover: vi.fn(async () => ({ ...pending, next: 'resume' })), resume, wait: vi.fn(async () => done) } as unknown as BridgeClient
    expect((await followRoundtripLeg(bridge, { checkpoint, persist: () => {} })).next).toBe('done')
    expect(execute).not.toHaveBeenCalled()
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('stops at xReserve provider handoff without claiming delivery', async () => {
    const handoff = { next: 'wait', plan: { protocol: 'xreserve' }, receipt: { status: 'DELIVERY_PENDING' } }
    const wait = vi.fn()
    const bridge = { recover: vi.fn(async () => handoff), wait } as unknown as BridgeClient
    expect((await followRoundtripLeg(bridge, { checkpoint, persist: () => {} })).next).toBe('wait')
    expect(wait).not.toHaveBeenCalled()
  })
})
