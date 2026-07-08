import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'node:fs'

import { startDevnode, type DevnodeInstance } from '@veil/devnode'
import { createDevnodeClient } from '@veil/provable-sdk'
import { createTestClient, getContract, http, parseProgram } from '@veil/core'
import type { PublicClient, WalletClient, TestClient, LocalAccount } from '@veil/core'

import { buildLeoProgram, type BuiltLeoProgram } from './leoProject.js'

/**
 * Write-path e2e against a devnode: deployContract, writeContract, the
 * getContract write surface, executeContract, and a rejected execution.
 * Ports the coverage that execute.integration.test.ts only has against the
 * real network (gated RUN_INTEGRATION, excluded from CI) to a local node.
 *
 * Gated behind VEIL_DEVNODE_INTEGRATION=1 because it requires the Leo CLI and
 * aleo-devnode on PATH and spawns a long-running devnode process.
 *
 * Run with:
 *   VEIL_DEVNODE_INTEGRATION=1 npx vitest run packages/provable-sdk/test/integration/devnodeWrite.e2e.test.ts
 */

const RUN = process.env.VEIL_DEVNODE_INTEGRATION === '1'

// Unique per-run suffix so repeat runs don't collide if storage ever persists.
const SUFFIX = Math.floor(Date.now() / 1000)
const PROGRAM_A = `veil_wtest_${SUFFIX}.aleo`
const PROGRAM_B = `veil_dtest_${SUFFIX}.aleo`

// Program A: happy-path mapping write, a pure function with a public output
// (so executeContract's returned outputs are assertable plaintext), and an
// on-chain assert that rejects on zero. Leo 4.3 syntax: `fn` + `final` blocks.
const SOURCE_A = `program ${PROGRAM_A} {
    @noupgrade
    constructor() {}

    mapping values: address => u64;

    fn set_value(public v: u64) -> Final {
        let caller = self.caller;
        return final {
            Mapping::set(values, caller, v);
        };
    }

    fn add_one(public v: u64) -> public u64 {
        return v + 1u64;
    }

    fn fail_if_zero(public v: u64) -> Final {
        return final {
            assert_neq(v, 0u64);
        };
    }
}
`

// Program B: minimal program deployed mid-suite by the deployContract test.
const SOURCE_B = `program ${PROGRAM_B} {
    @noupgrade
    constructor() {}

    fn ping(public v: u64) -> u64 {
        return v + 1u64;
    }
}
`

describe.runIf(RUN)('e2e: devnode write path (deploy, write, execute, reject)', () => {
  let devnode: DevnodeInstance | null = null
  let testClient: TestClient
  let publicClient: PublicClient
  let walletClient: WalletClient
  let account: LocalAccount<'privateKey'>
  let programA: BuiltLeoProgram | undefined
  let programB: BuiltLeoProgram | undefined

  beforeAll(async () => {
    // Compile both programs before spending time on the devnode boot.
    programA = await buildLeoProgram(PROGRAM_A, SOURCE_A)
    programB = await buildLeoProgram(PROGRAM_B, SOURCE_B)

    devnode = await startDevnode({ readyTimeout: 45_000 })
    testClient = createTestClient({
      transport: http(`http://${devnode.socketAddr}`, { network: 'testnet' }),
    })
    ;({ publicClient, walletClient, account } = createDevnodeClient())

    // Devnode needs one block before the first deploy.
    await testClient.advanceBlock({ count: 1 })
    const deployTxId = await walletClient.deployContract({ program: programA.compiled })
    expect(deployTxId).toMatch(/^at1/)
    await testClient.advanceBlock({ count: 1 })
  }, 180_000)

  afterAll(async () => {
    // Cleanup must not fail the suite; each step tolerates the previous one
    // having already brought the devnode down.
    try {
      await testClient?.shutdown()
    } catch {
      // devnode may already be down — the stop() below is the backstop
    }
    try {
      await devnode?.stop()
    } catch {
      // already shut down via testClient.shutdown()
    }
    for (const program of [programA, programB]) {
      if (program) rmSync(program.dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('deployContract deploys a second program: tx id, accepted status, readable source', async () => {
    const txId = await walletClient.deployContract({ program: programB!.compiled })
    expect(txId).toMatch(/^at1/)

    await testClient.advanceBlock({ count: 1 })

    const { status } = await walletClient.transactionStatus({ transactionId: txId })
    expect(status).toBe('accepted')

    const source = await publicClient.getCode({ programId: PROGRAM_B })
    expect(source).toContain(`program ${PROGRAM_B}`)
  }, 120_000)

  it('writeContract executes and the finalize write lands in the mapping', async () => {
    const txId = await walletClient.writeContract({
      program: PROGRAM_A,
      function: 'set_value',
      inputs: ['42u64'],
    })
    expect(txId).toMatch(/^at1/)

    await testClient.advanceBlock({ count: 1 })

    const { status } = await walletClient.transactionStatus({ transactionId: txId })
    expect(status).toBe('accepted')

    const value = await publicClient.readContract({
      programId: PROGRAM_A,
      mapping: 'values',
      key: account.address,
    })
    expect(value).toBe('42u64')
  }, 120_000)

  it('getContract write surface submits through the same devnode client', async () => {
    const contract = getContract({
      program: PROGRAM_A,
      abi: parseProgram(programA!.compiled),
      client: { public: publicClient, wallet: walletClient },
    })

    const txId = await contract.write.set_value!({ inputs: [7] })
    expect(txId).toMatch(/^at1/)

    await testClient.advanceBlock({ count: 1 })

    const value = await contract.read.values!({ key: account.address })
    expect(value).toBe('7u64')
  }, 120_000)

  it('a finalize assert failure surfaces as rejected transaction status', async () => {
    const txId = await walletClient.writeContract({
      program: PROGRAM_A,
      function: 'fail_if_zero',
      inputs: ['0u64'],
    })
    expect(txId).toMatch(/^at1/)

    await testClient.advanceBlock({ count: 1 })

    const { status } = await walletClient.transactionStatus({ transactionId: txId })
    expect(status).toBe('rejected')
  }, 120_000)
})
