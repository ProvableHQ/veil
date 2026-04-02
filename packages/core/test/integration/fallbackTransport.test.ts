import { describe, it, expect, vi } from 'vitest'
import { createPublicClient } from '../../src/clients/createPublicClient.js'
import { createWalletClient } from '../../src/clients/createWalletClient.js'
import { custom } from '../../src/transports/custom.js'
import { fallback } from '../../src/transports/fallback.js'

describe('integration: fallback transport switching', () => {
  it('falls back from failing wallet transport to working http transport', async () => {
    // Wallet transport only handles wallet methods, throws on reads
    const walletRequest = vi.fn().mockRejectedValue(
      new Error('Wallet transport does not handle method "getLatestHeight"'),
    )
    const httpRequest = vi.fn().mockResolvedValue(42000)

    const walletTransport = custom({ request: walletRequest, key: 'wallet' })
    const httpTransport = custom({ request: httpRequest, key: 'http' })

    const client = createPublicClient({
      transport: fallback([walletTransport, httpTransport]),
    })

    const height = await client.getBlockNumber()

    expect(height).toBe(42000n)
    expect(walletRequest).toHaveBeenCalledTimes(1)
    expect(httpRequest).toHaveBeenCalledTimes(1)
  })

  it('uses wallet transport when it handles the method', async () => {
    const walletRequest = vi.fn().mockResolvedValue('at1txid123')
    const httpRequest = vi.fn().mockResolvedValue('at1txid_http')

    const walletTransport = custom({ request: walletRequest, key: 'wallet' })
    const httpTransport = custom({ request: httpRequest, key: 'http' })

    const transport = fallback([walletTransport, httpTransport])

    // Direct transport call for executeTransaction
    const result = await transport.request({
      method: 'executeTransaction',
      params: { programName: 'test.aleo', functionName: 'run', inputs: [], fee: 0n },
    })

    expect(result).toBe('at1txid123')
    // Should succeed on first transport, never reaching the second
    expect(httpRequest).not.toHaveBeenCalled()
  })

  it('tries all transports in order before failing', async () => {
    const calls: string[] = []

    const t1 = custom({
      request: vi.fn().mockImplementation(async () => {
        calls.push('t1')
        throw new Error('t1 failed')
      }),
    })
    const t2 = custom({
      request: vi.fn().mockImplementation(async () => {
        calls.push('t2')
        throw new Error('t2 failed')
      }),
    })
    const t3 = custom({
      request: vi.fn().mockImplementation(async () => {
        calls.push('t3')
        return 'success'
      }),
    })

    const transport = fallback([t1, t2, t3])
    const result = await transport.request({ method: 'test' })

    expect(result).toBe('success')
    expect(calls).toEqual(['t1', 't2', 't3'])
  })

  it('preserves the error from the last failing transport', async () => {
    const t1 = custom({
      request: vi.fn().mockRejectedValue(new Error('first error')),
    })
    const t2 = custom({
      request: vi.fn().mockRejectedValue(new Error('second error')),
    })

    const transport = fallback([t1, t2])

    try {
      await transport.request({ method: 'test' })
      expect.fail('should have thrown')
    } catch (err: any) {
      expect(err.message).toBe('All transports failed.')
      expect(err.cause.message).toBe('second error')
    }
  })
})
