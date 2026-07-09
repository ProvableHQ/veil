import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTestClient, http } from '@provablehq/veil-core'
import {
  startDevnode,
  advanceDevnode,
  restoreDevnode,
  devnodeActions,
  type DevnodeInstance,
} from '../src/index.js'

/**
 * Exercises every test-client action (advanceBlock, getMappingKeysValues,
 * snapshot, listSnapshots, shutdown) and every devnode action (startDevnode,
 * advanceDevnode, restoreDevnode) against a real aleo-devnode — no Leo compile
 * and no proving, so it isolates the node-control surface.
 *
 * Gated behind VEIL_DEVNODE_INTEGRATION=1 because it requires aleo-devnode on
 * PATH and spawns real node processes.
 *
 * Run with:
 *   VEIL_DEVNODE_INTEGRATION=1 npx vitest run packages/devnode/test/devnodeActions.integration.test.ts
 */

const RUN = process.env.VEIL_DEVNODE_INTEGRATION === '1'

// A non-default port so the run does not collide with an ambient devnode.
const SOCKET = '127.0.0.1:3033'

describe.runIf(RUN)('test-client + devnode actions (integration)', () => {
  it(
    'drives every action against a live devnode, including a snapshot/restore round-trip',
    async () => {
      // Persistent storage is required for snapshot/restore; an in-memory node
      // has nothing to capture.
      const storage = mkdtempSync(join(tmpdir(), 'veil-devnode-'))
      const snapshotsDir = `${storage}-snapshots`
      let node: DevnodeInstance | null = null

      const height = async (): Promise<number> => {
        const res = await fetch(`http://${SOCKET}/testnet/block/height/latest`)
        return Number(await res.json())
      }

      // Waits until nothing answers on the socket, so restore can take the
      // storage lock (aleo-devnode restore requires the server stopped).
      const waitForDown = async (): Promise<void> => {
        for (let i = 0; i < 40; i++) {
          try {
            await fetch(`http://${SOCKET}/testnet/block/height/latest`, {
              signal: AbortSignal.timeout(500),
            })
          } catch {
            return
          }
          await new Promise((r) => setTimeout(r, 250))
        }
        throw new Error('devnode did not stop responding in time')
      }

      try {
        // --- startDevnode (devnode action) ---
        node = await startDevnode({
          socketAddr: SOCKET,
          storagePath: storage,
          clearStorage: true,
          manualBlockCreation: true,
          readyTimeout: 45_000,
        })
        expect(node.socketAddr).toBe(SOCKET)

        const client = createTestClient({
          transport: http(`http://${SOCKET}`, { network: 'testnet' }),
        }).extend(devnodeActions)

        expect(await height()).toBe(0)

        // --- advanceBlock (test action) — must honor count > 1 ---
        await client.advanceBlock({ count: 3 })
        expect(await height()).toBe(3)

        // --- advanceDevnode via client extension (devnode action) ---
        await client.advanceDevnode({ numBlocks: 2, socketAddr: SOCKET })
        expect(await height()).toBe(5)

        // --- advanceDevnode standalone (devnode action) ---
        await advanceDevnode({ numBlocks: 1, socketAddr: SOCKET })
        const checkpointHeight = await height()
        expect(checkpointHeight).toBe(6)

        // --- getMappingKeysValues (test action) ---
        const entries = await client.getMappingKeysValues({
          programId: 'credits.aleo',
          mapping: 'account',
        })
        expect(Array.isArray(entries)).toBe(true)
        expect(entries.length).toBeGreaterThan(0)
        expect(entries.every((e) => Array.isArray(e) && e.length === 2)).toBe(true)

        // --- snapshot named (test action) ---
        const snap = await client.snapshot({ name: 'checkpoint' })
        expect(snap.name).toBe('checkpoint')
        expect(snap.height).toBe(checkpointHeight)

        // --- snapshot auto-named (test action) ---
        const snapAuto = await client.snapshot()
        expect(typeof snapAuto.name).toBe('string')
        expect(snapAuto.name.length).toBeGreaterThan(0)

        // --- listSnapshots (test action) ---
        const names = await client.listSnapshots()
        expect(names).toContain('checkpoint')
        expect(names).toContain(snapAuto.name)

        // Diverge from the checkpoint so the restore is observable.
        await client.advanceBlock({ count: 2 })
        expect(await height()).toBe(8)

        // --- shutdown (test action) — stop the node so restore can take the lock ---
        await client.shutdown()
        try {
          await node.stop()
        } catch {
          // already gone via shutdown()
        }
        node = null
        await waitForDown()

        // --- restoreDevnode (devnode action) — rewinds storage to the checkpoint ---
        await restoreDevnode({ snapshot: 'checkpoint', storage })

        // Reload the restored ledger (no clearStorage) and confirm the rewind.
        node = await startDevnode({
          socketAddr: SOCKET,
          storagePath: storage,
          manualBlockCreation: true,
          readyTimeout: 45_000,
        })
        expect(await height()).toBe(checkpointHeight)
      } finally {
        if (node) {
          try {
            await node.stop()
          } catch {
            // ignore
          }
        }
        rmSync(storage, { recursive: true, force: true })
        rmSync(snapshotsDir, { recursive: true, force: true })
      }
    },
    180_000,
  )
})
