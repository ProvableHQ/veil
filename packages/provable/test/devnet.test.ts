/**
 * Devnet integration tests — spawns a local aleo-devnode for fast,
 * deterministic testing without hitting a live network.
 *
 * Requires: `aleo-devnode` binary (https://github.com/ProvableHQ/aleo-devnode)
 * Run with: RUN_DEVNET=true pnpm vitest run packages/provable/test/devnet.test.ts
 *
 * The devnode:
 * - Starts in ~1 second on a random port
 * - Has instant block finality (automine)
 * - Skips proof verification for speed
 * - Self-contained — no external dependencies
 *
 * Important: The devnode uses TEST_CONSENSUS_VERSION_HEIGHTS (V9 at height 12,
 * V14 at height 17) but the SDK WASM defaults to real testnet heights (V9 at
 * ~9.8M). We call getOrInitConsensusVersionTestHeights() before any SDK
 * operations to align the height tables, enabling deployments and other
 * consensus-version-dependent operations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, execSync, type ChildProcess } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { loadNetwork, type AleoSdk } from '../src/index.js'
import {
  ConfigurationError,
  InvalidTransactionError,
  DuplicateTransactionError,
  RecordSpentError,
  classifyBroadcastError,
  parseProgram,
} from '@veil/core'

// ── Configuration ────────────────────────────────────────────────────

const DEVNODE_KEY = 'APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH'
const DEVNODE_PORT = 3031 + Math.floor(Math.random() * 100)
const DEVNODE_URL = `http://127.0.0.1:${DEVNODE_PORT}`
const STARTUP_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 200
// The devnode auto-advances to this height on startup (TEST_CONSENSUS_VERSION_HEIGHTS last entry)
const DEVNODE_TARGET_HEIGHT = 17

const shouldRun = process.env.RUN_DEVNET === 'true'

const HELLO_PROGRAM = [
  'program hello_deploy_test.aleo;',
  '',
  'constructor:',
  '    assert.eq true true;',
  '',
  'function hello:',
  '    input r0 as u32.public;',
  '    input r1 as u32.private;',
  '    add r0 r1 into r2;',
  '    output r2 as u32.private;',
].join('\n')

// ── Harness ──────────────────────────────────────────────────────────

/** Returns the devnode command: prefers aleo-devnode, falls back to leo devnode */
function resolveDevnode(): { cmd: string; args: string[] } | null {
  try {
    execSync('aleo-devnode --help', { stdio: 'pipe' })
    return { cmd: 'aleo-devnode', args: ['start'] }
  } catch {}
  try {
    execSync('leo --version', { stdio: 'pipe' })
    return { cmd: 'leo', args: ['devnode', 'start', '--network', 'testnet'] }
  } catch {}
  return null
}

const devnodeCmd = resolveDevnode()

/**
 * Wait for the devnode to be ready AND to finish advancing to the latest
 * consensus version. The devnode auto-creates empty blocks to reach the
 * target height after the REST API starts, so we poll until the height
 * reaches the expected value.
 */
async function waitForDevnode(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/testnet/block/height/latest`)
      if (res.ok) {
        const height = Number(await res.text())
        if (height >= DEVNODE_TARGET_HEIGHT) return
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`Devnode at ${url} did not reach height ${DEVNODE_TARGET_HEIGHT} within ${timeoutMs}ms`)
}

// ── Tests ────────────────────────────────────────────────────────────

let devnode: ChildProcess | undefined
let aleo: AleoSdk
let sdk: typeof import('@provablehq/sdk')
let account: ReturnType<AleoSdk['privateKeyToAccount']>

describe.skipIf(!shouldRun || !devnodeCmd)('devnet integration', () => {
  beforeAll(async () => {
    // Align the SDK's consensus height table with the devnode's test heights.
    // Must be called BEFORE any other SDK operation (OnceLock-based).
    sdk = await import('@provablehq/sdk')
    sdk.getOrInitConsensusVersionTestHeights()

    const { cmd, args } = devnodeCmd!
    devnode = spawn(cmd, [
      ...args,
      '--private-key', DEVNODE_KEY,
      '--socket-addr', `127.0.0.1:${DEVNODE_PORT}`,
      ...(cmd === 'aleo-devnode' ? ['-v', '0'] : ['-q']),
    ], { stdio: 'ignore', detached: false })

    await waitForDevnode(DEVNODE_URL, STARTUP_TIMEOUT_MS)
    aleo = await loadNetwork('testnet')
    account = aleo.privateKeyToAccount(DEVNODE_KEY)
  }, STARTUP_TIMEOUT_MS + 5_000)

  afterAll(async () => {
    if (devnode) {
      // Graceful shutdown via REST, fallback to SIGTERM
      try { await fetch(`${DEVNODE_URL}/testnet/shutdown`, { method: 'POST' }) } catch {}
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

  it('simulate runs program locally', async () => {
    const { walletClient } = aleo.createAleoClient({
      privateKey: DEVNODE_KEY,
      networkUrl: DEVNODE_URL,
      provingMode: 'local',
    })

    const result = await walletClient.simulateContract({
      program: 'hello_deploy_test.aleo',
      function: 'hello',
      inputs: ['5u32', '3u32'],
      programSource: HELLO_PROGRAM,
    })

    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0]).toBe('8u32')
  }, 60_000)

  // ── Execute ────────────────────────────────────────────────────────

  it('execute confirms on devnode', async () => {
    const { walletClient } = aleo.createAleoClient({
      privateKey: DEVNODE_KEY,
      networkUrl: DEVNODE_URL,
      provingMode: 'local',
    })

    const result = await walletClient.executeContract({
      program: 'credits.aleo',
      function: 'transfer_public',
      inputs: [account.address, '1u64'],
    })

    expect(result.transactionId).toMatch(/^at1/)
    expect(result.transitions).toBeDefined()
    expect(result.outputs).toBeDefined()
  }, 120_000)

  // ── getCode + parseProgram ────────────────────────────────────────

  it('getCode fetches program source from devnode', async () => {
    const { publicClient } = aleo.createAleoClient({
      privateKey: DEVNODE_KEY,
      networkUrl: DEVNODE_URL,
    })

    const source = await publicClient.getCode({ programId: 'credits.aleo' })
    expect(source).toContain('program credits.aleo')
    expect(source).toContain('function transfer_public')
  }, 30_000)

  it('parseProgram extracts correct structure from fetched source', async () => {
    const { publicClient } = aleo.createAleoClient({
      privateKey: DEVNODE_KEY,
      networkUrl: DEVNODE_URL,
    })

    const source = await publicClient.getCode({ programId: 'credits.aleo' })
    const program = parseProgram(source)

    expect(program.id).toBe('credits.aleo')

    // credits.aleo has transfer_public, transfer_private, etc.
    const fnNames = program.functions.map((f) => f.name)
    expect(fnNames).toContain('transfer_public')
    expect(fnNames).toContain('transfer_private')

    // transfer_public takes (address, u64) and has a finalize block
    const transferPublic = program.functions.find((f) => f.name === 'transfer_public')!
    expect(transferPublic.inputs).toHaveLength(2)
    expect(transferPublic.inputs[0]!.type).toBe('address')
    expect(transferPublic.inputs[1]!.type).toBe('u64')
    expect(transferPublic.hasFinalize).toBe(true)

    // credits.aleo has the "account" mapping
    const mappingNames = program.mappings.map((m) => m.name)
    expect(mappingNames).toContain('account')
    const accountMapping = program.mappings.find((m) => m.name === 'account')!
    expect(accountMapping.keyType).toBe('address')
    expect(accountMapping.valueType).toBe('u64')
  }, 30_000)

  // ── Deploy ─────────────────────────────────────────────────────────

  it('deploy custom program to devnode', async () => {
    const networkClient = aleo.createNetworkClient(DEVNODE_URL)
    const pm = new sdk.ProgramManager(DEVNODE_URL)
    pm.setAccount(new sdk.Account({ privateKey: DEVNODE_KEY }))

    const tx = await pm.buildDevnodeDeploymentTransaction({
      program: HELLO_PROGRAM,
      priorityFee: 0,
      privateFee: false,
    })

    const txId = await networkClient.submitTransaction(tx)
    expect(txId).toMatch(/^at1/)
    await new Promise((r) => setTimeout(r, 2_000))

    const source = await networkClient.getProgram('hello_deploy_test.aleo')
    expect(source).toContain('program hello_deploy_test.aleo')
    expect(source).toContain('function hello')
  }, 120_000)

  // ── Simulate vs execute consistency ────────────────────────────────

  it('simulate predicts execute output', async () => {
    // Depends on hello_deploy_test.aleo being deployed above
    const { walletClient } = aleo.createAleoClient({
      privateKey: DEVNODE_KEY,
      networkUrl: DEVNODE_URL,
      provingMode: 'local',
    })

    const simResult = await walletClient.simulateContract({
      program: 'hello_deploy_test.aleo',
      function: 'hello',
      inputs: ['5u32', '3u32'],
      programSource: HELLO_PROGRAM,
    })

    const execResult = await walletClient.executeContract({
      program: 'hello_deploy_test.aleo',
      function: 'hello',
      inputs: ['5u32', '3u32'],
    })

    // Simulate returns plaintext; execute returns encrypted ciphertext
    // for private outputs. Both should produce the same number of outputs.
    expect(simResult.outputs[0]).toBe('8u32')
    expect(simResult.outputs).toHaveLength(execResult.outputs.length)
    expect(execResult.transactionId).toMatch(/^at1/)
  }, 120_000)

  // ── Codegen pipeline: deploy → getContract → simulate ──────────────

  it('deploy loyalty program and simulate mint_card via getContract', async () => {
    const networkClient = aleo.createNetworkClient(DEVNODE_URL)
    const pm = new sdk.ProgramManager(DEVNODE_URL)
    pm.setAccount(new sdk.Account({ privateKey: DEVNODE_KEY }))

    // Deploy loyalty_token.aleo
    const loyaltySource = readFileSync(
      resolve(__dirname, '../../../apps/loyalty-node/loyalty_token/build/main.aleo'),
      'utf-8',
    )
    const tx = await pm.buildDevnodeDeploymentTransaction({
      program: loyaltySource,
      priorityFee: 0,
      privateFee: false,
    })
    const txId = await networkClient.submitTransaction(tx)
    expect(txId).toMatch(/^at1/)
    await new Promise((r) => setTimeout(r, 2_000))

    // Fetch the deployed source and parse it into an ABI
    const { publicClient, walletClient } = aleo.createAleoClient({
      privateKey: DEVNODE_KEY,
      networkUrl: DEVNODE_URL,
      provingMode: 'local',
    })
    const fetchedSource = await publicClient.getCode({ programId: 'loyalty_token.aleo' })
    const program = parseProgram(fetchedSource)

    // Verify parseProgram found the right functions
    const fnNames = program.functions.map((f) => f.name)
    expect(fnNames).toContain('mint_card')
    expect(fnNames).toContain('add_points')
    expect(fnNames).toContain('spend_points')

    const result = await walletClient.simulateContract({
      program: 'loyalty_token.aleo',
      function: 'mint_card',
      inputs: [account.address, '500u64', '1field'],
      programSource: fetchedSource,
    })

    // mint_card outputs: [LoyaltyCard record plaintext, future]
    expect(result.outputs.length).toBeGreaterThanOrEqual(1)
    const cardOutput = result.outputs[0]!
    // Record plaintext contains the field values
    expect(cardOutput).toContain('owner')
    expect(cardOutput).toContain('points')
    expect(cardOutput).toContain('500u64')
  }, 180_000)

  // ── Cross-program per-transition outputs (#13) ─────────────────────

  it('cross-program call returns per-transition outputs', async () => {
    // Depends on loyalty_token.aleo deployed in the codegen test above
    const networkClient = aleo.createNetworkClient(DEVNODE_URL)
    const pm = new sdk.ProgramManager(DEVNODE_URL)
    pm.setAccount(new sdk.Account({ privateKey: DEVNODE_KEY }))

    // Deploy loyalty_rewards.aleo (imports loyalty_token.aleo)
    const rewardsSource = readFileSync(
      resolve(__dirname, '../../../apps/loyalty-node/loyalty_rewards/build/main.aleo'),
      'utf-8',
    )
    const loyaltySource = readFileSync(
      resolve(__dirname, '../../../apps/loyalty-node/loyalty_token/build/main.aleo'),
      'utf-8',
    )
    const deployTx = await pm.buildDevnodeDeploymentTransaction({
      program: rewardsSource,
      priorityFee: 0,
      privateFee: false,
    })
    await networkClient.submitTransaction(deployTx)
    await new Promise((r) => setTimeout(r, 2_000))

    // Mint a LoyaltyCard with enough points to redeem
    const mintTx = await pm.buildDevnodeExecutionTransaction({
      programName: 'loyalty_token.aleo',
      functionName: 'mint_card',
      inputs: [account.address, '1000u64', '99field'],
      priorityFee: 0,
      privateFee: false,
    })
    const mintTxId = await networkClient.submitTransaction(mintTx)
    await new Promise((r) => setTimeout(r, 2_000))

    // Extract the minted LoyaltyCard record
    const mintConfirmed = await networkClient.getTransaction(mintTxId)
    const mintTransition = mintConfirmed?.execution?.transitions?.[0]
    const cardOutput = mintTransition?.outputs?.find((o: any) => o.type === 'record')
    expect(cardOutput).toBeDefined()

    const cardCiphertext = sdk.RecordCiphertext.fromString(cardOutput.value)
    const viewKey = sdk.ViewKey.from_string(account.viewKey)
    const cardPlaintext = cardCiphertext.decrypt(viewKey).toString()

    // Call redeem_points_for_voucher (cross-program: calls loyalty_token/spend_points)
    const redeemTx = await pm.buildDevnodeExecutionTransaction({
      programName: 'loyalty_rewards.aleo',
      functionName: 'redeem_points_for_voucher',
      inputs: [cardPlaintext, '1u8', '500u64'],
      priorityFee: 0,
      privateFee: false,
      imports: { 'loyalty_token.aleo': loyaltySource },
    })
    const redeemTxId = await networkClient.submitTransaction(redeemTx)
    await new Promise((r) => setTimeout(r, 2_000))

    // Verify per-transition outputs
    const confirmed = await networkClient.getTransaction(redeemTxId)
    const transitions = confirmed?.execution?.transitions ?? []

    // Should have 2+ transitions: inner (loyalty_token/spend_points) then outer (loyalty_rewards/redeem)
    expect(transitions.length).toBeGreaterThanOrEqual(2)

    const programs = transitions.map((t: any) => t.program)
    expect(programs).toContain('loyalty_token.aleo')
    expect(programs).toContain('loyalty_rewards.aleo')

    // Inner transition: loyalty_token/spend_points
    const innerTransition = transitions.find((t: any) => t.program === 'loyalty_token.aleo')
    expect(innerTransition.function).toBe('spend_points')

    // Outer transition: loyalty_rewards/redeem_points_for_voucher (last per Aleo semantics)
    const outerTransition = transitions[transitions.length - 1]
    expect(outerTransition.program).toBe('loyalty_rewards.aleo')
    expect(outerTransition.function).toBe('redeem_points_for_voucher')
  }, 240_000)

  // ── Mapping read/write round-trip ───────────────────────────────────

  it('mapping reflects on-chain state after execution', async () => {
    // mint_card (from codegen test above) wrote to total_cards[0field]
    const { publicClient } = aleo.createAleoClient({
      privateKey: DEVNODE_KEY,
      networkUrl: DEVNODE_URL,
    })

    const totalCards = await publicClient.readContract({
      programId: 'loyalty_token.aleo',
      mapping: 'total_cards',
      key: '0field',
    })

    // At least 1 card was minted (codegen test minted one, cross-program test minted another)
    expect(totalCards).toBeDefined()
    expect(totalCards).toContain('u64')
    const count = BigInt(totalCards.replace('u64', ''))
    expect(count).toBeGreaterThanOrEqual(1n)
  }, 30_000)

  // ── Record round-trip as input (#18) ──────────────────────────────

  it('RecordValue output used as input to next execution', async () => {
    const networkClient = aleo.createNetworkClient(DEVNODE_URL)
    const pm = new sdk.ProgramManager(DEVNODE_URL)
    pm.setAccount(new sdk.Account({ privateKey: DEVNODE_KEY }))

    // Mint a fresh card
    const mintTx = await pm.buildDevnodeExecutionTransaction({
      programName: 'loyalty_token.aleo',
      functionName: 'mint_card',
      inputs: [account.address, '2000u64', '777field'],
      priorityFee: 0,
      privateFee: false,
    })
    const mintTxId = await networkClient.submitTransaction(mintTx)
    await new Promise((r) => setTimeout(r, 2_000))

    // Extract and decrypt the minted card record
    const mintConfirmed = await networkClient.getTransaction(mintTxId)
    const mintTransition = mintConfirmed?.execution?.transitions?.[0]
    const cardOutput = mintTransition?.outputs?.find((o: any) => o.type === 'record')
    expect(cardOutput).toBeDefined()

    const cardCiphertext = sdk.RecordCiphertext.fromString(cardOutput.value)
    const viewKey = sdk.ViewKey.from_string(account.viewKey)
    const cardPlaintext = cardCiphertext.decrypt(viewKey).toString()

    // Use the record as input to add_points
    const addTx = await pm.buildDevnodeExecutionTransaction({
      programName: 'loyalty_token.aleo',
      functionName: 'add_points',
      inputs: [cardPlaintext, '500u64'],
      priorityFee: 0,
      privateFee: false,
    })
    const addTxId = await networkClient.submitTransaction(addTx)
    await new Promise((r) => setTimeout(r, 2_000))

    // Verify the updated card has more points
    const addConfirmed = await networkClient.getTransaction(addTxId)
    const addTransition = addConfirmed?.execution?.transitions?.[0]
    const updatedOutput = addTransition?.outputs?.find((o: any) => o.type === 'record')
    expect(updatedOutput).toBeDefined()

    const updatedCiphertext = sdk.RecordCiphertext.fromString(updatedOutput.value)
    const updatedCard = updatedCiphertext.decrypt(viewKey).toString()

    // Original 2000 + 500 added = 2500
    expect(updatedCard).toContain('2500u64')
  }, 180_000)

  // ── getContract execute with transitions ───────────────────────────

  it('getContract execute proxy returns parsed transitions', async () => {
    const { getContract } = await import('@veil/core')

    const { publicClient, walletClient } = aleo.createAleoClient({
      privateKey: DEVNODE_KEY,
      networkUrl: DEVNODE_URL,
      provingMode: 'local',
    })

    const contract = getContract({
      program: 'credits.aleo',
      client: { public: publicClient, wallet: walletClient },
    })

    const result = await contract.execute.transfer_public({
      inputs: [account.address, '1u64'],
    })

    expect(result.transactionId).toMatch(/^at1/)
    expect(result.transitions).toBeDefined()
    expect(result.transitions.length).toBeGreaterThanOrEqual(1)

    // The called function's transition should be present
    const creditTransition = result.transitions.find(
      (t) => t.program === 'credits.aleo' && t.function === 'transfer_public',
    )
    expect(creditTransition).toBeDefined()
    expect(creditTransition!.outputs).toBeDefined()
  }, 120_000)

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

  it('duplicate transaction submission classifies as DuplicateTransactionError', async () => {
    const networkClient = aleo.createNetworkClient(DEVNODE_URL)
    const pm = new sdk.ProgramManager(DEVNODE_URL)
    pm.setAccount(new sdk.Account({ privateKey: DEVNODE_KEY }))

    const tx = await pm.buildExecutionTransaction({
      programName: 'credits.aleo',
      functionName: 'transfer_public',
      inputs: [account.address, '1u64'],
      priorityFee: 0,
      privateFee: false,
    })

    const txString = tx.toString()

    // First submission — should succeed
    networkClient.setVerboseErrors(false)
    const txId = await networkClient.submitTransaction(txString)
    expect(txId).toMatch(/^at1/)

    // Wait for confirmation so it's on-chain
    await new Promise((r) => setTimeout(r, 2_000))

    // Second submission of the same transaction — should fail
    try {
      await networkClient.submitTransaction(txString)
      expect.fail('Should have thrown for duplicate transaction')
    } catch (e) {
      const classified = classifyBroadcastError(e, txId)
      expect(classified).toBeInstanceOf(DuplicateTransactionError)
    }
  }, 120_000)

  it('double-spend of private record classifies as RecordSpentError', async () => {
    const networkClient = aleo.createNetworkClient(DEVNODE_URL)
    networkClient.setVerboseErrors(false)
    const pm = new sdk.ProgramManager(DEVNODE_URL)
    pm.setAccount(new sdk.Account({ privateKey: DEVNODE_KEY }))

    // Step 1: transfer_public_to_private to create a private credits record
    const createRecordTx = await pm.buildDevnodeExecutionTransaction({
      programName: 'credits.aleo',
      functionName: 'transfer_public_to_private',
      inputs: [account.address, '1000u64'],
      priorityFee: 0,
      privateFee: false,
    })
    await networkClient.submitTransaction(createRecordTx)
    await new Promise((r) => setTimeout(r, 2_000))

    // Step 2: Find the record we just created by scanning the transaction outputs
    // The record is the first output of the transition (a credits.record)
    const txId = createRecordTx.id()
    const confirmedTx = await networkClient.getTransaction(txId)
    const transition = confirmedTx?.execution?.transitions?.[0]
    const recordOutput = transition?.outputs?.find((o: any) => o.type === 'record')
    expect(recordOutput).toBeDefined()

    // Decrypt the record
    const recordCiphertext = sdk.RecordCiphertext.fromString(recordOutput.value)
    const viewKey = sdk.ViewKey.from_string(account.viewKey)
    expect(recordCiphertext.isOwner(viewKey)).toBe(true)
    const recordPlaintext = recordCiphertext.decrypt(viewKey)

    // Step 3: Spend the record via transfer_private
    const spendTx = await pm.buildDevnodeExecutionTransaction({
      programName: 'credits.aleo',
      functionName: 'transfer_private',
      inputs: [recordPlaintext.toString(), account.address, '500u64'],
      priorityFee: 0,
      privateFee: false,
    })
    await networkClient.submitTransaction(spendTx)
    await new Promise((r) => setTimeout(r, 2_000))

    // Step 4: Try to spend the SAME record again — should fail with duplicate serial number
    try {
      const doubleSpendTx = await pm.buildDevnodeExecutionTransaction({
        programName: 'credits.aleo',
        functionName: 'transfer_private',
        inputs: [recordPlaintext.toString(), account.address, '400u64'],
        priorityFee: 0,
        privateFee: false,
      })
      await networkClient.submitTransaction(doubleSpendTx)
      expect.fail('Should have thrown for double-spend')
    } catch (e) {
      const classified = classifyBroadcastError(e)
      expect(classified).toBeInstanceOf(RecordSpentError)
    }
  }, 180_000)

  it('finalize revert produces rejected transaction', async () => {
    // The execution proof passes (just arithmetic), but the finalize block
    // does `get account[sender] → sub` which underflows and reverts.
    const networkClient = aleo.createNetworkClient(DEVNODE_URL)
    networkClient.setVerboseErrors(false)
    const pm = new sdk.ProgramManager(DEVNODE_URL)
    pm.setAccount(new sdk.Account({ privateKey: DEVNODE_KEY }))

    // Transfer an impossibly large amount — more than any account could have
    const tx = await pm.buildDevnodeExecutionTransaction({
      programName: 'credits.aleo',
      functionName: 'transfer_public',
      inputs: [account.address, '18446744073709551615u64'], // u64::MAX
      priorityFee: 0,
      privateFee: false,
    })
    const txId = await networkClient.submitTransaction(tx)
    await new Promise((r) => setTimeout(r, 2_000))

    // Check the confirmed transaction — finalize should have reverted
    const confirmed = await networkClient.getConfirmedTransaction(txId)
    expect(confirmed).toBeDefined()
    expect(confirmed.status).toBe('rejected')
  }, 120_000)

  // Note: OutputIdCollisionError is not tested here — it requires crafting a
  // transaction with duplicate output IDs, which the SDK prevents through normal
  // APIs. This is a program-level bug scenario, not triggerable through standard
  // transaction flow. Validated via unit tests against known message patterns.

  it('ConfigurationError thrown for missing proverUrl in delegated mode', async () => {
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
