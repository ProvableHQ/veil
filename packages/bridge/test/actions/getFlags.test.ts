import { describe, it, expect, vi } from 'vitest'
import { getFlags } from '../../src/actions/getFlags.js'
import { BridgeEnvelopeError } from '../../src/errors/bridgeErrors.js'
import type { Client } from '@provablehq/veil-core'

function makeClient(response: unknown): Client {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as Client
}

describe('getFlags', () => {
  it('returns the flags from the envelope', async () => {
    const client = makeClient({ data: { near_supports_pub_priv_swaps: true } })

    const result = await getFlags(client)

    expect(result.near_supports_pub_priv_swaps).toBe(true)
    expect(client.request as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
      method: 'getBridgeFlags',
    })
  })

  it('throws BridgeEnvelopeError when the envelope has no data', async () => {
    const client = makeClient({})

    await expect(getFlags(client)).rejects.toThrow(BridgeEnvelopeError)
  })
})
