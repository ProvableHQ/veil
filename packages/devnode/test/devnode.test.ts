import { describe, it, expect } from 'vitest'
import {
  DEVNODE_PRIVATE_KEY,
  DEVNODE_ADDR,
  startDevnode,
  advanceDevnode,
  restoreDevnode,
} from '../src/index.js'

describe('@veil/devnode', () => {
  describe('constants', () => {
    it('DEVNODE_PRIVATE_KEY has correct format', () => {
      expect(DEVNODE_PRIVATE_KEY).toMatch(/^APrivateKey1/)
    })

    it('DEVNODE_ADDR is 127.0.0.1:3030', () => {
      expect(DEVNODE_ADDR).toBe('127.0.0.1:3030')
    })
  })

  describe('startDevnode', () => {
    it('is a function', () => {
      expect(startDevnode).toBeTypeOf('function')
    })

    it('rejects quickly when the binary path is invalid', async () => {
      await expect(
        startDevnode({ devnodePath: '/does/not/exist/aleo-devnode', readyTimeout: 100 }),
      ).rejects.toThrow()
    }, 5_000)
  })

  describe('advanceDevnode', () => {
    it('is a function', () => {
      expect(advanceDevnode).toBeTypeOf('function')
    })

    it('rejects when the binary path is invalid', async () => {
      await expect(
        advanceDevnode({ devnodePath: '/does/not/exist/aleo-devnode' }),
      ).rejects.toThrow()
    }, 5_000)
  })

  describe('restoreDevnode', () => {
    it('is a function', () => {
      expect(restoreDevnode).toBeTypeOf('function')
    })

    it('rejects when the binary path is invalid', async () => {
      await expect(
        restoreDevnode({ snapshot: 'test', devnodePath: '/does/not/exist/aleo-devnode' }),
      ).rejects.toThrow()
    }, 5_000)
  })
})

/**
 * Integration tests — require a running aleo-devnode binary.
 *
 * Run with: DEVNODE_INTEGRATION=1 vitest run
 *
 * describe('startDevnode (integration)', () => {
 *   let devnode: DevnodeInstance
 *
 *   beforeAll(async () => {
 *     devnode = await startDevnode()
 *   }, 30_000)
 *
 *   afterAll(async () => {
 *     await devnode.stop()
 *   })
 *
 *   it('returns the correct socket address', () => {
 *     expect(devnode.socketAddr).toBe(DEVNODE_ADDR)
 *   })
 *
 *   it('REST API responds to health check', async () => {
 *     const res = await fetch(`http://${devnode.socketAddr}/testnet/block/height/latest`)
 *     expect(res.ok).toBe(true)
 *   })
 *
 *   it('stop() terminates the process', async () => {
 *     await devnode.stop()
 *     await expect(
 *       fetch(`http://${devnode.socketAddr}/testnet/block/height/latest`)
 *     ).rejects.toThrow()
 *   })
 * })
 */
