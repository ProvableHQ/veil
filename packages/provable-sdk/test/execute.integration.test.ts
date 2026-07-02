/**
 * Integration tests for the execute lifecycle.
 *
 * These tests hit the real Aleo network and require:
 * - A funded account (uses the SDK demo account)
 * - Network connectivity to api.provable.com
 *
 * Run with: RUN_INTEGRATION=true pnpm vitest run packages/provable-sdk/test/execute.integration.test.ts
 *
 * For delegated tests, also set:
 *   ALEO_DPS_API_KEY, ALEO_CONSUMER_ID (and optionally ALEO_DPS_URL)
 *
 * Skipped by default in CI / normal test runs.
 *
 * TODO: Error classifier validation against real SnarkOS responses.
 * The classifyBroadcastError/classifyProvingError functions match on SnarkOS
 * error message strings. A SnarkOS upgrade that rephrases error messages
 * (e.g. "duplicate output id" → "output identifier conflict") would silently
 * degrade typed errors to BroadcastError. A devnet integration harness that
 * submits known-bad transactions and asserts the correct typed error class
 * would catch this drift. See PR #49 review comment #6.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork, type AleoSdk } from '../src/index.js'

// SDK demo account — funded on testnet
const DEMO_PRIVATE_KEY = 'APrivateKey1zkp6aEqdUdRpZs1fnfGBEitWZNzxNhPz4kb2W382nuX8G42'
const DEMO_ADDRESS = 'aleo1vskzxa2qqgnhznxsqh6tgq93c30sfkj6xqwe7sr85lgjkexjlcxs3lxhy3'
const NETWORK_URL = 'https://api.provable.com/v2'

// DPS credentials — set via env vars for delegated tests
const DPS_URL = process.env.ALEO_DPS_URL ?? 'https://api.provable.com/prove/testnet'
const DPS_API_KEY = process.env.ALEO_DPS_API_KEY
const DPS_CONSUMER_ID = process.env.ALEO_CONSUMER_ID

const shouldRun = process.env.RUN_INTEGRATION === 'true'
const hasDpsCredentials = !!(DPS_API_KEY && DPS_CONSUMER_ID)

// Minimal program for simulate-only tests (doesn't need to be deployed)
const HELLO_PROGRAM = `program hello_test_veil.aleo;

function hello:
    input r0 as u32.public;
    input r1 as u32.private;
    add r0 r1 into r2;
    output r2 as u32.private;`

// Cross-program test vectors taken from the @provablehq/sdk JSDoc examples
// (see `getProgramImports` in program-manager.d.ts). `double_test.aleo/double_it`
// calls `multiply_test.aleo/multiply`, yielding a two-transition Authorization.
const MULTIPLY_TEST_SOURCE = `program multiply_test.aleo;

function multiply:
    input r0 as u32.public;
    input r1 as u32.private;
    mul r0 r1 into r2;
    output r2 as u32.private;`

const DOUBLE_TEST_SOURCE = `import multiply_test.aleo;

program double_test.aleo;

function double_it:
    input r0 as u32.private;
    call multiply_test.aleo/multiply 2u32 r0 into r1;
    output r1 as u32.private;`

// Load the SDK once for all tests
let aleo: AleoSdk

beforeAll(async () => {
  if (shouldRun) {
    aleo = await loadNetwork('testnet')
  }
})

describe.skipIf(!shouldRun)('simulate (integration)', () => {
  it('simulate runs program locally and returns typed outputs', async () => {
    const account = aleo.privateKeyToAccount(DEMO_PRIVATE_KEY)
    const config = aleo.createProvingConfig({
      mode: 'local',
      networkUrl: NETWORK_URL,
      account,
    })

    const result = await config.simulate!({
      programName: 'hello_test_veil.aleo',
      functionName: 'hello',
      inputs: ['5u32', '3u32'],
      programSource: HELLO_PROGRAM,
    })

    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0]).toBe('8u32')
  }, 120_000)

  it('simulateContract via createAleoClient works end-to-end', async () => {
    const { walletClient } = aleo.createAleoClient({
      privateKey: DEMO_PRIVATE_KEY,
      networkUrl: NETWORK_URL,
      provingMode: 'local',
    })

    const result = await walletClient.simulateContract({
      program: 'hello_test_veil.aleo',
      function: 'hello',
      inputs: ['5u32', '3u32'],
      programSource: HELLO_PROGRAM,
    })

    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0]).toBe('8u32')
  }, 120_000)

  it('simulate builds a real cross-program Authorization with two transitions', async () => {
    // Exercises buildAuthorization end-to-end against the wasm SDK via the full
    // walletClient surface: `double_it(5u32)` internally calls `multiply(2u32, 5u32)`,
    // so both transitions surface in the Authorization (both outputting `10u32`).
    // No network needed — both program sources are supplied inline.
    const { walletClient } = aleo.createAleoClient({
      privateKey: DEMO_PRIVATE_KEY,
      networkUrl: NETWORK_URL,
      provingMode: 'local',
    })

    const result = await walletClient.simulateContract({
      program: 'double_test.aleo',
      function: 'double_it',
      inputs: ['5u32'],
      programSource: DOUBLE_TEST_SOURCE,
      imports: { 'multiply_test.aleo': MULTIPLY_TEST_SOURCE },
    })

    expect(result.transitions).toHaveLength(2)

    // Inner transition: multiply_test.aleo/multiply(2u32, 5u32) → 10u32
    expect(result.transitions[0]!.program).toBe('multiply_test.aleo')
    expect(result.transitions[0]!.function).toBe('multiply')
    expect(result.transitions[0]!.outputs).toEqual(['10u32'])

    // Outer (top-level) transition: double_test.aleo/double_it(5u32) → 10u32
    expect(result.transitions[1]!.program).toBe('double_test.aleo')
    expect(result.transitions[1]!.function).toBe('double_it')
    expect(result.transitions[1]!.outputs).toEqual(['10u32'])

    // Top-level outputs is the last (outer) transition's outputs.
    expect(result.outputs).toEqual(['10u32'])
  }, 120_000)
})

describe.skipIf(!shouldRun)('execute lifecycle (integration)', () => {
  // Uses credits.aleo transfer_public — self-transfer of 1 microcredit.
  // Requires the demo account to have a public balance (1 microcredit transfer + ~2,725 base fee).

  it('local execute: prove, broadcast, confirm, return outputs', async () => {
    const account = aleo.privateKeyToAccount(DEMO_PRIVATE_KEY)
    const config = aleo.createProvingConfig({
      mode: 'local',
      networkUrl: NETWORK_URL,
      account,
    })

    const result = await config.execute!({
      programName: 'credits.aleo',
      functionName: 'transfer_public',
      inputs: [DEMO_ADDRESS, '1u64'],
      fee: 0n,
    })

    expect(result.transactionId).toMatch(/^at1/)
    expect(result.outputs).toBeDefined()
  }, 300_000)

  it('createAleoClient wires execute end-to-end', async () => {
    const { walletClient } = aleo.createAleoClient({
      privateKey: DEMO_PRIVATE_KEY,
      networkUrl: NETWORK_URL,
      provingMode: 'local',
    })

    const result = await walletClient.executeContract({
      program: 'credits.aleo',
      function: 'transfer_public',
      inputs: [DEMO_ADDRESS, '1u64'],
      fee: 0n,
    })

    expect(result.transactionId).toMatch(/^at1/)
    expect(result.outputs).toBeDefined()
  }, 300_000)
})

describe.skipIf(!shouldRun || !hasDpsCredentials)('delegated execute (integration)', () => {
  it('delegated execute: submit to DPS, confirm, return outputs', async () => {
    const account = aleo.privateKeyToAccount(DEMO_PRIVATE_KEY)
    const config = aleo.createProvingConfig({
      mode: 'delegated',
      networkUrl: NETWORK_URL,
      proverUrl: DPS_URL,
      apiKey: DPS_API_KEY,
      consumerId: DPS_CONSUMER_ID,
      account,
    })

    const result = await config.execute!({
      programName: 'credits.aleo',
      functionName: 'transfer_public',
      inputs: [DEMO_ADDRESS, '1u64'],
      fee: 0n,
    })

    expect(result.transactionId).toMatch(/^at1/)
    expect(result.outputs).toBeDefined()
  }, 300_000)

  it('createAleoClient delegated execute end-to-end', async () => {
    const { walletClient } = aleo.createAleoClient({
      privateKey: DEMO_PRIVATE_KEY,
      networkUrl: NETWORK_URL,
      provingMode: 'delegated',
      proverUrl: DPS_URL,
      apiKey: DPS_API_KEY,
      consumerId: DPS_CONSUMER_ID,
    })

    const result = await walletClient.executeContract({
      program: 'credits.aleo',
      function: 'transfer_public',
      inputs: [DEMO_ADDRESS, '1u64'],
      fee: 0n,
    })

    expect(result.transactionId).toMatch(/^at1/)
    expect(result.outputs).toBeDefined()
  }, 300_000)
})
