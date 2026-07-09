import { describe, it, expect } from 'vitest'
import { createLeoClient } from '../src/index.js'

describe('@provablehq/veil-leo', () => {
  describe('createLeoClient', () => {
    it('returns a client with the expected surface', () => {
      const client = createLeoClient()
      expect(client.build).toBeTypeOf('function')
      expect(client.abi).toBeTypeOf('function')
      expect(client.deploy).toBeTypeOf('function')
      expect(client.synthesize).toBeTypeOf('function')
    })

    it('exposes the constructor config', () => {
      const client = createLeoClient({ cwd: '/tmp/foo', network: 'testnet' })
      expect(client.config.cwd).toBe('/tmp/foo')
      expect(client.config.network).toBe('testnet')
    })

    it('build rejects quickly when the leo binary path is invalid', async () => {
      const client = createLeoClient({ leoPath: '/does/not/exist/leo' })
      await expect(client.build()).rejects.toThrow()
    }, 5_000)
  })
})
