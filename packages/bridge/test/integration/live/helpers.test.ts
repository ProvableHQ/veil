import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mainnetCaseEnabled, mainnetExecutionEnabled, oneAtomicUnit } from './config.js'
import { createLiveBenchmark, loadLiveState, saveLiveState, waitForAleoTransaction, waitForHyperlaneDelivery } from './helpers.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('live bridge checkpoints', () => {
  it('reports per-step and total elapsed time', () => {
    const times = [1_000, 1_250, 1_900]
    const log = vi.fn()
    const benchmark = createLiveBenchmark('route', () => times.shift()!, log)

    benchmark.mark('quote')
    benchmark.mark('submit')

    expect(log).toHaveBeenNthCalledWith(1, '[route] quote: +250ms (total 250ms)')
    expect(log).toHaveBeenNthCalledWith(2, '[route] submit: +650ms (total 900ms)')
  })

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

describe('Hyperlane live delivery', () => {
  it('uses PostgreSQL bytea hashes and normalizes explorer results', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string, variables: { hash: string } }
      expect(body.query).toContain('$hash: bytea!')
      expect(body.variables.hash).toBe('\\xsource')
      return new Response(JSON.stringify({
        data: {
          message_view: [{
            msg_id: '\\xmessage',
            is_delivered: true,
            destination_tx_hash: '\\xdestination',
          }],
        },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(waitForHyperlaneDelivery('0xsource')).resolves.toEqual({
      messageId: '0xmessage',
      destinationTxId: '0xdestination',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('surfaces GraphQL errors instead of polling until timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      errors: [{ message: 'invalid bytea input' }],
    }))))

    await expect(waitForHyperlaneDelivery('0xsource')).rejects.toThrow(
      'Hyperlane explorer query failed: invalid bytea input',
    )
  })
})

describe('Aleo live confirmation', () => {
  it('rejects a transaction whose execution was rejected on chain', async () => {
    const client = {
      getTransaction: vi.fn(async () => ({})),
      getConfirmedTransaction: vi.fn(async () => ({ status: 'rejected' })),
    }

    await expect(waitForAleoTransaction(client, 'at1rejected')).rejects.toThrow(
      'Aleo transaction at1rejected was rejected',
    )
  })
})
