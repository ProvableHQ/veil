import { describe, expect, it } from 'vitest'
import { createAleoClient } from '../../src/connections/aleo.js'
import { createEvmClient, evmCustom } from '../../src/connections/evm.js'
import { requireEvmClient } from '../../src/connections/resolve.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'

describe('bridge client resolution', () => {
  it('resolves the exact registry chain and required capability', () => {
    const client = createEvmClient({ transport: evmCustom(async () => '0x1') })
    expect(requireEvmClient(DEFAULT_BRIDGE_REGISTRY, { ethereum: client }, 'ethereum')).toBe(client)
  })

  it('rejects missing, mismatched, and incomplete clients before network access', () => {
    expect(() => requireEvmClient(DEFAULT_BRIDGE_REGISTRY, {}, 'ethereum')).toThrow(
      'No client is configured for chain "ethereum"',
    )
    const wrong = createAleoClient({ publicClient: {} as never })
    expect(() => requireEvmClient(DEFAULT_BRIDGE_REGISTRY, { ethereum: wrong }, 'ethereum')).toThrow(
      'Client "ethereum" has family "aleo"; the registry declares "evm"',
    )
  })
})
