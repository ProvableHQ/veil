/**
 * Devnet integration tests — spawns a local Leo devnode for fast,
 * deterministic testing without hitting a live network.
 *
 * Requires: `leo` CLI installed (v4.0.0+)
 * Run with: RUN_DEVNET=true pnpm vitest run packages/provable/test/devnet.test.ts
 *
 * The devnode:
 * - Starts in ~1 second on a random port
 * - Has instant block finality (automine)
 * - Skips proof verification for speed
 * - Self-contained — no external dependencies
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, execSync, type ChildProcess } from 'child_process'
import { loadNetwork, type AleoSdk } from '../src/index.js'
import {
  ConfigurationError,
  InvalidTransactionError,
  classifyBroadcastError,
} from '@veil/core'

// ── Configuration ────────────────────────────────────────────────────

const DEVNODE_KEY = 'APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH'
const DEVNODE_PORT = 3031 + Math.floor(Math.random() * 100)
const DEVNODE_URL = `http://127.0.0.1:${DEVNODE_PORT}`
const STARTUP_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 200

const shouldRun = process.env.RUN_DEVNET === 'true'

// ── Harness ──────────────────────────────────────────────────────────

function isLeoInstalled(): boolean {
  try {
    execSync('leo --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

async function waitForDevnode(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/testnet/block/height/latest`)
      if (res.ok) return
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`Devnode at ${url} did not become ready within ${timeoutMs}ms`)
}

// ── Tests ────────────────────────────────────────────────────────────

let devnode: ChildProcess | undefined
let aleo: AleoSdk

describe.skipIf(!shouldRun || !isLeoInstalled())('devnet integration', () => {
  beforeAll(async () => {
    devnode = spawn('leo', [
      'devnode', 'start',
      '--private-key', DEVNODE_KEY,
      '--network', 'testnet',
      '--socket-addr', `127.0.0.1:${DEVNODE_PORT}`,
      '-q',
    ], { stdio: 'ignore', detached: false })

    await waitForDevnode(DEVNODE_URL, STARTUP_TIMEOUT_MS)
    aleo = await loadNetwork('testnet')
  }, STARTUP_TIMEOUT_MS + 5_000)

  afterAll(() => {
    if (devnode) {
      devnode.kill('SIGTERM')
      devnode = undefined
    }
  })

  // ── Basic connectivity ─────────────────────────────────────────────

  it('devnode responds to height query', async () => {
    const res = await fetch(`${DEVNODE_URL}/testnet/block/height/latest`)
    const height = await res.text()
    expect(Number(height)).toBeGreaterThanOrEqual(0)
  })

  // ── Simulate ───────────────────────────────────────────────────────

  it('simulate runs program locally against devnode', async () => {
    const config = aleo.createProvingConfig({
      mode: 'local',
      networkUrl: DEVNODE_URL,
      account: aleo.privateKeyToAccount(DEVNODE_KEY),
    })

    const HELLO = `program hello_devnet_test.aleo;\n\nfunction hello:\n    input r0 as u32.public;\n    input r1 as u32.private;\n    add r0 r1 into r2;\n    output r2 as u32.private;`

    const result = await config.simulate!({
      programName: 'hello_devnet_test.aleo',
      functionName: 'hello',
      inputs: ['5u32', '3u32'],
      programSource: HELLO,
    })

    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0]).toBe('8u32')
  }, 60_000)

  // ── Execute ────────────────────────────────────────────────────────

  it('execute with instant devnode confirmation', async () => {
    const account = aleo.privateKeyToAccount(DEVNODE_KEY)
    const { walletClient } = aleo.createAleoClient({
      privateKey: DEVNODE_KEY,
      networkUrl: DEVNODE_URL,
      provingMode: 'local',
    })

    const result = await walletClient.executeTransaction({
      program: 'credits.aleo',
      function: 'transfer_public',
      inputs: [account.address, '1u64'],
    })

    expect(result.transactionId).toMatch(/^at1/)
    expect(result.outputs).toBeDefined()
  }, 120_000)

  // ── fetchAbi end-to-end ────────────────────────────────────────────

  it('getCode fetches program source from devnode', async () => {
    const { publicClient } = aleo.createAleoClient({
      privateKey: DEVNODE_KEY,
      networkUrl: DEVNODE_URL,
    })

    // credits.aleo is always on the devnode genesis
    const source = await publicClient.getCode({ programId: 'credits.aleo' })
    expect(source).toContain('program credits.aleo')
    expect(source).toContain('function transfer_public')
  }, 30_000)

  // ── Error classifier validation against real SnarkOS ───────────────
  // These tests submit known-bad transactions and verify that Veil's
  // error classifiers produce the correct typed error from real SnarkOS
  // responses — catching vocabulary drift from SnarkOS upgrades.

  it('SnarkOS error message classifies as InvalidTransactionError', async () => {
    // Submit malformed JSON directly to the broadcast endpoint to get a real SnarkOS error
    const res = await fetch(`${DEVNODE_URL}/testnet/transaction/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'at1fake', type: 'execute' }),
    })
    const text = await res.text()

    // Feed the real SnarkOS error through our classifier
    const classified = classifyBroadcastError(new Error(text))
    expect(classified).toBeInstanceOf(InvalidTransactionError)
  })

  it('ConfigurationError thrown for missing proverUrl in delegated mode', async () => {
    const account = aleo.privateKeyToAccount(DEVNODE_KEY)
    const config = aleo.createProvingConfig({
      mode: 'delegated',
      networkUrl: DEVNODE_URL,
      account,
      // no proverUrl — should throw ConfigurationError
    })

    try {
      await config.execute!({
        programName: 'credits.aleo',
        functionName: 'transfer_public',
        inputs: [account.address, '1u64'],
        fee: 0n,
      })
      expect.fail('Should have thrown ConfigurationError')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigurationError)
      expect((e as ConfigurationError).message).toContain('proverUrl')
    }
  })
})
