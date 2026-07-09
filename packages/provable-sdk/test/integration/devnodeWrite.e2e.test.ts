import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'node:fs'

import { startDevnode, type DevnodeInstance } from '@veil/devnode'
import { createDevnodeClient, generateAccount } from '@veil/provable-sdk'
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
// (so executeContract's returned outputs are assertable plaintext), an
// on-chain assert that rejects on zero, and a function returning a record
// with a nested struct plus a public struct (complex output decoding).
// Leo 4.3 syntax: `fn` + `final` blocks; structs live outside the program block.
const SOURCE_A = `struct Point {
    x: u64,
    y: u64,
}

struct Shape {
    origin: Point,
    scale: u64,
}

program ${PROGRAM_A} {
    @noupgrade
    constructor() {}

    record Artifact {
        owner: address,
        shape: Shape,
        tag: field,
    }

    fn make_artifact(public sx: u64, public sy: u64, public scale: u64) -> (Artifact, public Shape) {
        let shape: Shape = Shape { origin: Point { x: sx, y: sy }, scale: scale };
        let art: Artifact = Artifact { owner: self.caller, shape: shape, tag: 7field };
        return (art, shape);
    }

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

  /**
   * Advances devnode blocks until `promise` settles or `timeoutMs` elapses.
   * The devnode auto-produces a block after each broadcast, so confirmation
   * normally lands without help — advancing while pending keeps the tests
   * correct if the suite ever switches to manualBlockCreation. The deadline
   * stops the loop from outliving a failed test and hitting a devnode that
   * afterAll already shut down.
   */
  async function advanceWhilePending<T>(promise: Promise<T>, timeoutMs = 60_000): Promise<T> {
    let settled = false
    // Both arms flip the flag; the rejection arm also marks the rejection
    // handled so the caller observes it via the returned promise.
    promise.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    const deadline = Date.now() + timeoutMs
    while (!settled && Date.now() < deadline) {
      await testClient.advanceBlock({ count: 1 })
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    return promise
  }

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

  it('executeContract returns the transition outputs directly', async () => {
    // executeContract waits for on-chain confirmation; advance concurrently
    // so the test also holds under manual block creation.
    const result = await advanceWhilePending(
      walletClient.executeContract({
        program: PROGRAM_A,
        function: 'add_one',
        inputs: ['99u64'],
      }),
    )

    // Public output of a pure transition — plaintext, assertable verbatim.
    expect(result.transactionId).toMatch(/^at1/)
    expect(result.outputs).toEqual(['100u64'])
    expect(result.transitions).toHaveLength(1)
    expect(result.transitions[0]).toMatchObject({
      program: PROGRAM_A,
      function: 'add_one',
      outputs: ['100u64'],
    })
  }, 120_000)

  it('executeContract confirms a finalizing transition and the mapping write lands', async () => {
    const result = await advanceWhilePending(
      walletClient.executeContract({
        program: PROGRAM_A,
        function: 'set_value',
        inputs: ['99u64'],
      }),
    )
    expect(result.transactionId).toMatch(/^at1/)
    expect(result.transitions.length).toBeGreaterThan(0)

    const value = await publicClient.readContract({
      programId: PROGRAM_A,
      mapping: 'values',
      key: account.address,
    })
    expect(value).toBe('99u64')
  }, 120_000)

  it('executeContract decodes a record with a nested struct and a public struct output', async () => {
    const result = await advanceWhilePending(
      walletClient.executeContract({
        program: PROGRAM_A,
        function: 'make_artifact',
        inputs: ['3u64', '4u64', '5u64'],
      }),
    )
    expect(result.transactionId).toMatch(/^at1/)
    expect(result.outputs).toHaveLength(2)

    // Output 0: the Artifact record, decrypted — owner plus the nested
    // struct's leaf values surface in the plaintext.
    const artifact = result.outputs[0]!
    expect(artifact).toContain(`owner: ${account.address}`)
    expect(artifact).toContain('x: 3u64')
    expect(artifact).toContain('y: 4u64')
    expect(artifact).toContain('scale: 5u64')
    expect(artifact).toContain('tag: 7field')

    // Output 1: the public Shape struct, plaintext with both nesting levels.
    const shape = result.outputs[1]!
    expect(shape).toContain('x: 3u64')
    expect(shape).toContain('y: 4u64')
    expect(shape).toContain('scale: 5u64')
    expect(shape).not.toContain('owner:')
  }, 120_000)

  it('executeContract spends a private record: transfer_public_to_private then transfer_private', async () => {
    // Mint a private record to self via the pre-deployed credits.aleo — the
    // record-creation path that needs no pre-existing records and no scanner
    // (requestRecords does not work against a devnode).
    const mint = await advanceWhilePending(
      walletClient.executeContract({
        program: 'credits.aleo',
        function: 'transfer_public_to_private',
        inputs: [account.address, '1000000u64'],
      }),
    )
    expect(mint.transactionId).toMatch(/^at1/)
    // The record output is owned by the executing account, so the devnode
    // client decrypts it to plaintext in the returned outputs.
    const minted = mint.outputs.find((o) => o.includes('microcredits'))
    expect(minted, 'expected a decrypted record among the outputs').toBeDefined()
    expect(minted).toContain('1000000u64')

    // Spend the record privately to a fresh account.
    const recipient = generateAccount()
    const spend = await advanceWhilePending(
      walletClient.executeContract({
        program: 'credits.aleo',
        function: 'transfer_private',
        inputs: [minted!, recipient.address, '400000u64'],
      }),
    )
    expect(spend.transactionId).toMatch(/^at1/)
    // The sender-owned change record decrypts to plaintext; the recipient's
    // record cannot be decrypted with this view key and passes through as a
    // `record1…` ciphertext, keeping its output position rather than being
    // dropped.
    const change = spend.outputs.find((o) => o.includes('microcredits'))
    expect(change, 'expected the decrypted change record among the outputs').toBeDefined()
    expect(change).toContain('600000u64')
    expect(
      spend.outputs.some((o) => o.startsWith('record1')),
      'expected the undecryptable recipient record to pass through as ciphertext',
    ).toBe(true)
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
