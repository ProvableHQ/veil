import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mainnetCaseEnabled, mainnetExecutionEnabled, oneAtomicUnit, requiredEvmPrivateKey } from './config.js'
import { createLiveBenchmark, loadLiveState, saveLiveState, waitForAleoTransaction, waitForHyperlaneDelivery } from './helpers.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('live bridge checkpoints', () => {
  it('normalizes prefixed and unprefixed EVM private keys', () => {
    const key = 'ab'.repeat(32)
    vi.stubEnv('TEST_EVM_KEY', key)
    expect(requiredEvmPrivateKey('TEST_EVM_KEY')).toBe(`0x${key}`)
    vi.stubEnv('TEST_EVM_KEY', `0x${key}`)
    expect(requiredEvmPrivateKey('TEST_EVM_KEY')).toBe(`0x${key}`)
  })

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

  it('decodes a Solana base58 signature to PostgreSQL bytea', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables: { hash: string } }
      expect(body.variables.hash).toBe(
        '\\x1491b6d2018d56b09ce9e368e701ccfc618485ff784f6419fe72d660a4a992d5f5d0a4392bf75b8172f57faeea28c3e660c0e9544e4320fb9f4df4d9cce9da06',
      )
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

    await expect(waitForHyperlaneDelivery(
      'QrRfJM8xSiKgvqgd8PeiYTgyA7EkLbzKSnEn5wV6amxA4P15cQY41Vh4H85km8RvTX5pDph6oKxhVzsewdGhdnM',
    )).resolves.toMatchObject({ destinationTxId: '0xdestination' })
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
