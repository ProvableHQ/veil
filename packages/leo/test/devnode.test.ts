import { describe, it, expect } from 'vitest'
import {
  DEVNODE_PRIVATE_KEY,
  DEVNODE_ADDR,
  createLeoClient,
} from '../src/index.js'

describe('@veil/leo', () => {
  describe('constants', () => {
    it('DEVNODE_PRIVATE_KEY has correct format', () => {
      expect(DEVNODE_PRIVATE_KEY).toMatch(/^APrivateKey1/)
    })

    it('DEVNODE_ADDR is 127.0.0.1:3030', () => {
      expect(DEVNODE_ADDR).toBe('127.0.0.1:3030')
    })
  })

  describe('createLeoClient', () => {
    it('returns a client with the expected surface', () => {
      const client = createLeoClient()
      expect(client.build).toBeTypeOf('function')
      expect(client.abi).toBeTypeOf('function')
      expect(client.deploy).toBeTypeOf('function')
      expect(client.synthesize).toBeTypeOf('function')
      expect(client.devnode.start).toBeTypeOf('function')
      expect(client.devnode.advance).toBeTypeOf('function')
    })

    it('exposes the constructor config', () => {
      const client = createLeoClient({ cwd: '/tmp/foo', network: 'testnet' })
      expect(client.config.cwd).toBe('/tmp/foo')
      expect(client.config.network).toBe('testnet')
    })

    it('devnode.start rejects quickly when the leo binary path is invalid', async () => {
      const client = createLeoClient({ leoPath: '/does/not/exist/leo' })
      await expect(client.devnode.start({ readyTimeout: 100 })).rejects.toThrow()
    }, 5_000)
  })
})

/**
 * Integration tests — require a running Leo CLI.
 *
 * Run with: VEIL_DEVNODE_INTEGRATION=1 vitest run
 *
 * describe.runIf(process.env.VEIL_DEVNODE_INTEGRATION === '1')('createLeoClient (integration)', () => {
 *   const client = createLeoClient()
 *
 *   it('starts and stops a devnode', async () => {
 *     const devnode = await client.devnode.start()
 *     expect(devnode.socketAddr).toBe(DEVNODE_ADDR)
 *     const res = await fetch(`http://${devnode.socketAddr}/testnet/block/height/latest`)
 *     expect(res.ok).toBe(true)
 *     await devnode.stop()
 *   }, 45_000)
 * })
 */
