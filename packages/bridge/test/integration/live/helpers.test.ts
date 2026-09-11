import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mainnetCaseEnabled, mainnetExecutionEnabled, oneAtomicUnit } from './config.js'
import { loadLiveState, saveLiveState } from './helpers.js'

afterEach(() => vi.unstubAllEnvs())

describe('live bridge checkpoints', () => {
  it('round-trips a route-bound checkpoint and starts only for an absent file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bridge-live-state-'))
    const path = join(directory, 'state.json')
    expect(loadLiveState(path, 'route:a')).toEqual({ routeId: 'route:a' })

    saveLiveState(path, { routeId: 'route:a', sourceTxId: 'source-1' })
    expect(loadLiveState(path, 'route:a')).toEqual({ routeId: 'route:a', sourceTxId: 'source-1' })
  })

  it('fails closed for corrupt, malformed, or wrong-route state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bridge-live-state-'))
    const path = join(directory, 'state.json')

    writeFileSync(path, '{')
    expect(() => loadLiveState(path, 'route:a')).toThrow()

    writeFileSync(path, JSON.stringify({ routeId: 'route:b', sourceTxId: 1 }))
    expect(() => loadLiveState(path, 'route:a')).toThrow(/does not match/)
  })
})

describe('mainnet live bridge safeguards', () => {
  it('requires funding, state, acknowledgement, and an explicit case', () => {
    vi.stubEnv('BRIDGE_LIVE_FUNDS', '1')
    vi.stubEnv('BRIDGE_LIVE_STATE_DIR', '/tmp/bridge-state')
    vi.stubEnv('BRIDGE_LIVE_MAINNET_ACK', 'I_ACKNOWLEDGE_BRIDGE_MAINNET_FUNDS')
    vi.stubEnv('BRIDGE_LIVE_MAINNET_CASES', 'evm-xreserve, aleo-hyperlane')

    expect(mainnetCaseEnabled('evm-xreserve')).toBe(true)
    expect(mainnetCaseEnabled('solana-hyperlane')).toBe(false)
  })

  it('requires a separate exact acknowledgement before submission', () => {
    vi.stubEnv('BRIDGE_LIVE_MAINNET_EXECUTE', 'yes')
    expect(mainnetExecutionEnabled()).toBe(false)
    vi.stubEnv('BRIDGE_LIVE_MAINNET_EXECUTE', 'I_ACKNOWLEDGE_THIS_SUBMITS_MAINNET_TRANSACTIONS')
    expect(mainnetExecutionEnabled()).toBe(true)
  })

  it('formats one atomic unit for each asset precision', () => {
    expect(oneAtomicUnit(0)).toBe('1')
    expect(oneAtomicUnit(6)).toBe('0.000001')
    expect(oneAtomicUnit(18)).toBe('0.000000000000000001')
  })
})
