import { describe, it, expect } from 'vitest'
import { rmSync } from 'node:fs'

import { startDevnode, type DevnodeInstance } from '@provablehq/veil-devnode'
import { createDevnodeClient } from '@provablehq/veil-sdk'
import { createTestClient, http } from '@provablehq/veil-core'

import { buildLeoProgram } from './leoProject.js'

/**
 * End-to-end devnode flow: build a Leo program, spin up a devnode, deploy,
 * advance a block, execute a function, advance another block, read the mapping,
 * shut the devnode down.
 *
 * Gated behind VEIL_DEVNODE_INTEGRATION=1 because it requires the Leo CLI and
 * aleo-devnode on PATH and spawns a long-running devnode process.
 *
 * Run with:
 *   VEIL_DEVNODE_INTEGRATION=1 npx vitest run packages/provable-sdk/test/integration/devnodeE2e.test.ts
 */

const RUN = process.env.VEIL_DEVNODE_INTEGRATION === '1'

// Unique per-run suffix so repeat runs don't collide if storage ever persists.
const PROGRAM_NAME = `veil_test_${Math.floor(Date.now() / 1000)}.aleo`
const PROGRAM_ID_NO_EXT = PROGRAM_NAME.replace(/\.aleo$/, '')

// Leo 4.3 syntax: `fn` + `final` blocks, and an explicit constructor.
const LEO_SOURCE = `program ${PROGRAM_NAME} {
    @noupgrade
    constructor() {}

    mapping values: address => u64;

    fn set_value(public v: u64) -> Final {
        let caller = self.caller;
        return final {
            Mapping::set(values, caller, v);
        };
    }
}
`

describe.runIf(RUN)('e2e: devnode deploy + execute + read + shutdown', () => {
  it(
    'scaffolds a Leo project, builds it, runs the full devnode flow',
    async () => {
      // --- 1 + 2. Scaffold and build the Leo program ---
      const { dir: projectDir, compiled: compiledAleo } = await buildLeoProgram(PROGRAM_NAME, LEO_SOURCE)
      let devnode: DevnodeInstance | null = null

      try {
        expect(compiledAleo).toMatch(new RegExp(`^program\\s+${PROGRAM_ID_NO_EXT}\\.aleo;`))

        // --- 3. Start a devnode (in-memory, fresh) ---
        devnode = await startDevnode({ readyTimeout: 45_000 })
        expect(devnode.socketAddr).toBe('127.0.0.1:3030')

        // --- 4. Wire test client (advanceBlock / shutdown) and devnode clients ---
        const testClient = createTestClient({
          transport: http(`http://${devnode.socketAddr}`, { network: 'testnet' }),
        })
        const { publicClient, walletClient, account } = createDevnodeClient()

        // --- 5. Advance a block before the first deploy ---
        await testClient.advanceBlock({ count: 1 })

        // --- 6. Deploy the compiled program ---
        const deployTxId = await walletClient.deployContract({
          program: compiledAleo,
        })
        expect(deployTxId).toMatch(/^at1/)

        // Give devnode a moment to finalize the deployment into the ledger.
        await testClient.advanceBlock({ count: 1 })

        // --- 7. Execute the program ---
        const VALUE = '42u64'
        const executeTxId = await walletClient.writeContract({
          program: PROGRAM_NAME,
          function: 'set_value',
          inputs: [VALUE],
        })
        expect(executeTxId).toMatch(/^at1/)

        // Advance so the finalize executes and the mapping is populated.
        await testClient.advanceBlock({ count: 1 })

        // --- 8. Read the mapping ---
        // Use the wallet's own address as the key (what self.caller resolves to).
        const value = await publicClient.readContract({
          programId: PROGRAM_NAME,
          mapping: 'values',
          key: account.address,
        })
        expect(value).toBe(VALUE)

        // --- 9. Shutdown ---
        await testClient.shutdown()
      } finally {
        // Defence-in-depth: stop the process even if shutdown misbehaved.
        if (devnode) {
          try {
            await devnode.stop()
          } catch {
            // ignore — already shut down via testClient.shutdown() most likely
          }
        }
        rmSync(projectDir, { recursive: true, force: true })
      }
    },
    120_000, // full flow: build (~5s) + devnode start (~15s) + tx cycles (~10s)
  )
})
