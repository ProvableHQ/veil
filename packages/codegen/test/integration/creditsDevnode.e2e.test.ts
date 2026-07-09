import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { startDevnode, type DevnodeInstance } from '@provablehq/veil-aleo-devnode'
import { createDevnodeClient } from '@provablehq/veil-aleo-sdk'
import { abi } from '@provablehq/veil-leo'
import { createTestClient, http, parseAbi } from '@provablehq/veil-core'
import type { PublicClient, WalletClient, TestClient, LocalAccount } from '@provablehq/veil-core'

import { generate } from '../../src/generate.js'

/**
 * Full codegen pipeline against a devnode: fetch credits.aleo from the node,
 * extract its ABI with `leo abi`, generate typed bindings, then run the
 * transfer round trip through them — transfer_public,
 * transfer_public_to_private, transfer_private, transfer_private_to_public —
 * asserting typed record decoding and on-chain balance effects.
 *
 * Gated behind VEIL_DEVNODE_INTEGRATION=1 because it requires the Leo CLI and
 * aleo-devnode on PATH and spawns a long-running devnode process.
 *
 * Run with:
 *   VEIL_DEVNODE_INTEGRATION=1 npx vitest run packages/codegen/test/integration/creditsDevnode.e2e.test.ts
 */

const RUN = process.env.VEIL_DEVNODE_INTEGRATION === '1'

const HERE = dirname(fileURLToPath(import.meta.url))
// Written at run time and gitignored; the computed import specifier below
// keeps tsc from resolving the module before it exists.
const GENERATED_DIR = join(HERE, 'generated')

describe.runIf(RUN)('e2e: codegen credits.aleo round trip on a devnode', () => {
  let devnode: DevnodeInstance | null = null
  let testClient: TestClient
  let publicClient: PublicClient
  let walletClient: WalletClient
  let account: LocalAccount<'privateKey'>
  // Typed surface comes from the runtime-generated module — untyped here.
  let contract: any
  let abiDir = ''

  /** Reads the account's public credits balance in microcredits. */
  async function balance(): Promise<bigint> {
    const value = await publicClient.readContract({
      programId: 'credits.aleo',
      mapping: 'account',
      key: account.address,
    })
    return BigInt(String(value).replace(/u64$/, ''))
  }

  beforeAll(async () => {
    devnode = await startDevnode({ readyTimeout: 45_000 })
    testClient = createTestClient({
      transport: http(`http://${devnode.socketAddr}`, { network: 'testnet' }),
    })
    ;({ publicClient, walletClient, account } = createDevnodeClient())
    await testClient.advanceBlock({ count: 1 })

    // 1. Pull the deployed program source straight from the devnode.
    const source = await publicClient.getCode({ programId: 'credits.aleo' })
    expect(source).toContain('program credits.aleo')

    // 2. Extract the ABI with the Leo CLI.
    abiDir = mkdtempSync(join(tmpdir(), 'veil-codegen-'))
    const sourcePath = join(abiDir, 'credits.aleo')
    writeFileSync(sourcePath, source)
    const rawAbi = await abi({ file: sourcePath, cwd: abiDir })

    // 3. Generate typed bindings and load them.
    const generated = generate({ abi: parseAbi(JSON.parse(rawAbi)) })
    mkdirSync(GENERATED_DIR, { recursive: true })
    writeFileSync(join(GENERATED_DIR, 'credits.ts'), generated)
    const specifier = './generated/' + 'credits.ts'
    const mod = await import(/* @vite-ignore */ specifier)
    contract = mod.createCreditsContract({ publicClient, walletClient })
  }, 180_000)

  afterAll(async () => {
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
    if (abiDir) rmSync(abiDir, { recursive: true, force: true })
    rmSync(GENERATED_DIR, { recursive: true, force: true })
  }, 60_000)

  it('round-trips credits through the generated typed bindings', async () => {
    const addr = account.address
    // The devnode charges a small base execution fee per transaction (a few
    // thousand microcredits), so public-balance checks assert the transfer
    // amount within a fee-sized tolerance rather than exact equality.
    const FEE_TOLERANCE = 50_000n
    const start = await balance()
    expect(start).toBeGreaterThan(2_000_000n)

    // 1. transfer_public to self: nets zero minus the fee.
    const pub = await contract.execute.transfer_public({ arg0: addr, arg1: '1000000u64' })
    expect(pub.transactionId).toMatch(/^at1/)
    const afterPub = await balance()
    expect(start - afterPub).toBeGreaterThanOrEqual(0n)
    expect(start - afterPub).toBeLessThan(FEE_TOLERANCE)

    // 2. transfer_public_to_private: mints a typed record, debits the balance.
    const mint = await contract.execute.transfer_public_to_private({ arg0: addr, arg1: '800000u64' })
    const minted = mint.result[0]
    expect(minted.owner).toBe(addr)
    expect(minted.microcredits).toBe(800_000n)
    const afterMint = await balance()
    expect(afterPub - afterMint).toBeGreaterThanOrEqual(800_000n)
    expect(afterPub - afterMint).toBeLessThan(800_000n + FEE_TOLERANCE)

    // 3. transfer_private to self: the typed record feeds back in via _record;
    //    both output records are ours and decode. Record amounts are exact —
    //    fees never come out of the transferred records.
    const spend = await contract.execute.transfer_private({ arg0: minted, arg1: addr, arg2: '300000u64' })
    const amounts = spend.result
      .map((r: { microcredits: bigint }) => r.microcredits)
      .sort((a: bigint, b: bigint) => (a < b ? -1 : 1))
    expect(amounts).toEqual([300_000n, 500_000n])

    // 4. transfer_private_to_public: the 300k record returns to the public
    //    balance, leaving only the 500k change record private.
    const sent = spend.result.find((r: { microcredits: bigint }) => r.microcredits === 300_000n)!
    const back = await contract.execute.transfer_private_to_public({ arg0: sent, arg1: addr, arg2: '300000u64' })
    expect(back.transactionId).toMatch(/^at1/)
    // The 300k input is fully consumed, so the returned change record is empty.
    const change = back.result[0] as { owner: string; microcredits: bigint }
    expect(change.owner).toBe(addr)
    expect(change.microcredits).toBe(0n)
    const afterBack = await balance()
    expect(afterBack - afterMint).toBeGreaterThan(300_000n - FEE_TOLERANCE)
    expect(afterBack - afterMint).toBeLessThanOrEqual(300_000n)
  }, 300_000)
})
