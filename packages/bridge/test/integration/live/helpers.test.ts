import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { loadLiveState, saveLiveState } from './helpers.js'

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
