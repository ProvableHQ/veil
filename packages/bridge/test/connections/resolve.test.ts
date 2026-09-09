import { describe, expect, it } from 'vitest'
import { aleoConnection, materializeAleoConnection } from '../../src/connections/aleo.js'
import { evmConnection, evmCustom, materializeEvmConnection } from '../../src/connections/evm.js'
import { requireEvmPublicConnection } from '../../src/connections/resolve.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'

describe('bridge connection resolution', () => {
  it('resolves the exact registry chain and required capability', () => {
    const connection = materializeEvmConnection(evmConnection({ transport: evmCustom(async () => '0x1') }), fetch)
    expect(requireEvmPublicConnection(DEFAULT_BRIDGE_REGISTRY, { ethereum: connection }, 'ethereum', 'quote')).toBe(connection)
  })

  it('rejects missing, mismatched, and incomplete connections before network access', () => {
    expect(() => requireEvmPublicConnection(DEFAULT_BRIDGE_REGISTRY, {}, 'ethereum', 'quote')).toThrow(
      'No connection is configured for chain "ethereum"',
    )
    const wrong = materializeAleoConnection(aleoConnection({ account: { executeTransaction: async () => 'tx' } }))
    expect(() => requireEvmPublicConnection(DEFAULT_BRIDGE_REGISTRY, { ethereum: wrong }, 'ethereum', 'quote')).toThrow(
      'Connection "ethereum" has family "aleo"; the registry declares "evm"',
    )
  })
})
