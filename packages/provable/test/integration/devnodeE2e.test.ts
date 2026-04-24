import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { leoActions, type DevnodeInstance } from '@veil/leo'
import { createDevnodeClient } from '@veil/provable'
import { createTestClient } from '@veil/core'
import { http } from '@veil/core'

/**
 * End-to-end devnode flow: build a Leo program, spin up a devnode, deploy,
 * advance a block, execute a function, advance another block, read the mapping,
 * shut the devnode down.
 *
 * Gated behind VEIL_DEVNODE_INTEGRATION=1 because it requires the Leo CLI on
 * PATH and spawns a long-running devnode process.
 *
 * Run with:
 *   VEIL_DEVNODE_INTEGRATION=1 npx vitest run packages/core/test/integration/devnodeE2e.test.ts
 */

const RUN = process.env.VEIL_DEVNODE_INTEGRATION === '1'

// Unique per-run suffix so repeat runs don't collide if storage ever persists.
const PROGRAM_NAME = `veil_test_${Math.floor(Date.now() / 1000)}.aleo`
const PROGRAM_ID_NO_EXT = PROGRAM_NAME.replace(/\.aleo$/, '')

const LEO_SOURCE = `program ${PROGRAM_NAME} {
    mapping values: address => u64;

    async transition set_value(public v: u64) -> Future {
        return finalize_set_value(self.caller, v);
    }

    async function finalize_set_value(caller: address, v: u64) {
        Mapping::set(values, caller, v);
    }
}
`

const PROGRAM_JSON = JSON.stringify(
  {
    program: PROGRAM_NAME,
    version: '0.0.0',
    description: 'veil e2e devnode test',
    license: 'MIT',
  },
  null,
  2,
)

describe.runIf(RUN)('e2e: devnode deploy + execute + read + shutdown', () => {
  it(
    'scaffolds a Leo project, builds it, runs the full devnode flow',
    async () => {
      // --- 1. Scaffold a Leo project in a tmpdir ---
      const projectDir = mkdtempSync(join(tmpdir(), 'veil-e2e-'))
      let devnode: DevnodeInstance | null = null

      try {
        mkdirSync(join(projectDir, 'src'), { recursive: true })
        writeFileSync(join(projectDir, 'src', 'main.leo'), LEO_SOURCE)
        writeFileSync(join(projectDir, 'program.json'), PROGRAM_JSON)

        // --- 2. Wire the test client + attach leo under `.leo` via extend ---
        // The test client's transport is pointed at the devnode's expected address;
        // it won't be exercised until devnode is running, but construction doesn't
        // require the process to be up.
        const testClient = createTestClient({
          transport: http(`http://127.0.0.1:3030`, { network: 'testnet' }),
        }).extend(leoActions({ cwd: projectDir }))

        // --- 3. Build the Leo program → produces build/main.aleo ---
        await testClient.leo.build()
        const compiledAleo = readFileSync(
          join(projectDir, 'build', 'main.aleo'),
          'utf-8',
        )
        expect(compiledAleo).toMatch(new RegExp(`^program\\s+${PROGRAM_ID_NO_EXT}\\.aleo;`))

        // --- 4. Start a devnode (in-memory, fresh) ---
        devnode = await testClient.leo.devnode.start({ readyTimeout: 45_000 })
        expect(devnode.socketAddr).toBe('127.0.0.1:3030')

        // --- 5. Create the devnode-aware public + wallet clients ---
        const { publicClient, walletClient, account } = createDevnodeClient()

        // --- 6. Advance a block before the first deploy ---
        await testClient.advanceBlock({ count: 1 })

        // --- 7. Deploy the compiled program ---
        const deployTxId = await walletClient.deployContract({
          program: compiledAleo,
          fee: 1_000_000n,
        })
        expect(deployTxId).toMatch(/^at1/)

        // Give devnode a moment to finalize the deployment into the ledger.
        await testClient.advanceBlock({ count: 1 })

        // --- 8. Execute the program ---
        const VALUE = '42u64'
        const executeTxId = await walletClient.writeContract({
          program: PROGRAM_NAME,
          function: 'set_value',
          inputs: [VALUE],
          fee: 100_000n,
        })
        expect(executeTxId).toMatch(/^at1/)

        // Advance so the finalize executes and the mapping is populated.
        await testClient.advanceBlock({ count: 1 })

        // --- 9. Read the mapping ---
        // Use the wallet's own address as the key (what self.caller resolves to).
        const value = await publicClient.readContract({
          programId: PROGRAM_NAME,
          mapping: 'values',
          key: account.address,
        })
        expect(value).toBe(VALUE)

        // --- 10. Shutdown via testClient ---
        await testClient.shutdown()
      } finally {
        // Defence-in-depth: SIGTERM the process even if the RPC shutdown misbehaved.
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
