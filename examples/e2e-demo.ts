/**
 * End-to-end demo: veil against the live Aleo network
 *
 * Run with: npx vitest run examples/
 *
 * This file doubles as both documentation and a live integration test.
 * Each section demonstrates a real veil API call hitting the Aleo mainnet.
 */

import { beforeAll, describe, it, expect } from 'vitest'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseProgram,
  getContract,
  isAddress,
  freezelistProofRequest,
  freezelistProofGrant,
} from '../packages/core/src/index.js'
import { aleoAgentTools } from '../packages/core/src/agent/index.js'
import { loadNetwork, type AleoSdk } from '../packages/provable-sdk/src/index.js'
import { ApiClient, shieldSwapAlgorithmGrants } from '../packages/shield-swap/src/index.js'
import { createAleoClient as createBridgeAleoClient, createBridgeClient, unshieldFreezelistProofGrant, DEFAULT_BRIDGE_REGISTRY } from '../packages/bridge/src/index.js'

const API_URL = 'https://edge.provable.com/api/v2'

describe.runIf(process.env.VEIL_INTEGRATION === '1')('Public Shield Swap market data', () => {
  it('discovers fee tiers without an account or API token', async () => {
    const api = new ApiClient()
    const tiers = await api.getFeeTiers()
    expect(tiers.data.length).toBeGreaterThan(0)
  }, 30_000)
})

// Wallet-only helpers are deterministic; actual proof resolution happens in
// a connected wallet after the matching connect-time grant is approved.
describe('Wallet freezelist proof setup', () => {
  it('includes constrained freezelist grants for automatic Shield Swap proofs', () => {
    const grants = shieldSwapAlgorithmGrants()
    expect(grants).toContainEqual(expect.objectContaining({
      algorithm: 'program-freezelist-exclusion-proof', program: 'shield_swap.aleo',
      function: 'mint', inputPosition: 8,
      argConstraints: { freezelistProgram: ['shield_swap_freezelist.aleo'] },
    }))
  })
  it('prepares a signer proof and grant for a private token transfer', () => {
    const proof = freezelistProofRequest({ freezelistProgram: 'compliance.aleo' })
    const grant = freezelistProofGrant({
      program: 'token.aleo', function: 'transfer_private', inputPosition: 3,
      freezelistProgram: 'compliance.aleo',
    })
    expect(proof.args).toEqual({ freezelistProgram: { type: 'string', value: 'compliance.aleo' } })
    expect(grant.argConstraints).toEqual({ freezelistProgram: ['compliance.aleo'] })
    // An ARC-22 wallet transfer passes recipient, amount, record, then `proof`.
    // These illustrative program names must match the deployed token and list.
  })
  it('inserts the Bridge unshield compliance request matching the connected wallet grant', async () => {
    const asset = { chain: 'aleo', asset: 'usdcx' }
    const grant = unshieldFreezelistProofGrant({ registry: DEFAULT_BRIDGE_REGISTRY, asset })
    const bridge = createBridgeClient({
      clients: { aleo: createBridgeAleoClient({
        publicClient: createPublicClient({ transport: http(API_URL, { network: 'mainnet' }) }),
        account: { executeTransaction: async (call) => {
          // Inspect the call without signing, proving, or submitting a transaction.
          expect(call).toMatchObject({ program: grant.program, function: grant.function })
          expect(call.inputs?.[grant.inputPosition]).toEqual({
            type: 'derived', algorithm: 'program-freezelist-exclusion-proof',
            args: { freezelistProgram: { type: 'string', value: 'usdcx_freezelist.aleo' } },
          })
          return 'at1example'
        } },
      }) },
    })
    await bridge.unshield({ asset, amount: '2.5' })
  })
})

describe('E2E: veil against live Aleo mainnet', () => {
  // Create a shared public client for all tests
  const publicClient = createPublicClient({
    transport: http(API_URL, { network: 'mainnet' }),
  })

  let aleo: AleoSdk
  beforeAll(async () => {
    aleo = await loadNetwork('mainnet')
  })

  it('getBlockNumber() returns the current chain height', async () => {
    const height = await publicClient.getBlockNumber()
    expect(height).toBeGreaterThan(15_000_000n)
    console.log('  Chain height:', height)
  })

  it('getBlock() fetches a block by height', async () => {
    const height = await publicClient.getBlockNumber()
    const block = await publicClient.getBlock({ height: Number(height) })
    expect(block).toBeDefined()
    expect(typeof (block as any).block_hash).toBe('string')
    console.log('  Block hash:', ((block as any).block_hash as string).substring(0, 40) + '...')
  })

  it('getCode() fetches program source and parseProgram() parses it', async () => {
    const source = await publicClient.getCode({ programId: 'credits.aleo' })
    expect(source.length).toBeGreaterThan(1000)

    const parsed = parseProgram(source)
    expect(parsed.id).toBe('credits.aleo')
    expect(parsed.functions.length).toBeGreaterThan(10)
    expect(parsed.mappings.length).toBeGreaterThan(0)

    const transferFn = parsed.functions.find(f => f.name === 'transfer_public')
    expect(transferFn).toBeDefined()
    expect(transferFn!.hasFinalize).toBe(true)

    const accountMapping = parsed.mappings.find(m => m.name === 'account')
    expect(accountMapping).toBeDefined()
    expect(accountMapping!.keyType).toBe('address')
    expect(accountMapping!.valueType).toBe('u64')

    console.log('  Functions:', parsed.functions.map(f => f.name).join(', '))
    console.log('  Mappings:', parsed.mappings.map(m => `${m.name}(${m.keyType}→${m.valueType})`).join(', '))
  })

  it('isArc20() / checkArcConformance() classify credits.aleo as non-ARC-20', async () => {
    // credits.aleo is the spec's canonical non-ARC-20 program: its record is
    // `credits` with `microcredits: u64`, not `Token` with `amount: u128`.
    const conforms = await publicClient.isArc20({ programId: 'credits.aleo' })
    expect(conforms).toBe(false)

    const report = await publicClient.checkArcConformance({ programId: 'credits.aleo', standard: 'arc20' })
    expect(report.conforms).toBe(false)
    expect(report.violations).toContainEqual({ kind: 'missing_record', name: 'Token' })
    console.log('  credits.aleo is ARC-20:', conforms, '—', report.violations.length, 'violations')
  })

  it('readContract() reads a program mapping value', async () => {
    // An absent key is not an error — the read resolves to null. A 404 only
    // means the request itself was malformed (bad key literal or program id).
    const result = await publicClient.readContract({
      programId: 'credits.aleo',
      mapping: 'account',
      key: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
    })
    console.log('  Mapping value:', result)
    expect(result === null || /u64$/.test(result)).toBe(true)
  })

  it('getContract() creates a typed contract instance', async () => {
    const source = await publicClient.getCode({ programId: 'credits.aleo' })
    const abi = parseProgram(source)

    const credits = getContract({
      program: 'credits.aleo',
      abi,
      client: publicClient,
    })

    expect(credits.program).toBe('credits.aleo')
    expect(credits.abi).toBeDefined()

    // Read through the contract instance — an absent key resolves to null
    const value = await credits.read.account({
      key: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
    })
    console.log('  credits.read.account():', value)
    expect(value === null || /u64$/.test(value)).toBe(true)

    // ABI validation — nonexistent mapping throws
    expect(() => credits.read.nonexistent({ key: 'test' })).toThrow('does not exist')
  })

  it('privateKeyToAccount() derives keys and signs messages', async () => {
    const account = aleo.generateAccount()

    expect(account.type).toBe('local')
    expect(account.source).toBe('privateKey')
    expect(isAddress(account.address)).toBe(true)
    expect(account.viewKey.startsWith('AViewKey1')).toBe(true)
    expect(account.privateKey.startsWith('APrivateKey1')).toBe(true)

    // Sign a message
    const message = new TextEncoder().encode('Hello from veil!')
    const signature = await account.sign(message)
    expect(signature.length).toBeGreaterThan(0)

    // Verify the signature
    const sigString = new TextDecoder().decode(signature)
    const verified = aleo.verifySignature(account.address, message, sigString)
    expect(verified).toBe(true)

    console.log('  Address:', account.address)
    console.log('  Sign + verify roundtrip: PASS')
  })

  it('privateKeyToAccount() restores from existing key', () => {
    const original = aleo.generateAccount()
    const restored = aleo.privateKeyToAccount(original.privateKey)

    expect(restored.address).toBe(original.address)
    expect(restored.viewKey).toBe(original.viewKey)
    console.log('  Key derivation roundtrip: PASS')
  })

  it('mnemonicToAccount() derives a Shield-compatible account from a mnemonic', () => {
    const mnemonic =
      'absurd letter switch already canoe piano wage sock unique all blade coyote'
    const account = aleo.mnemonicToAccount(mnemonic)

    expect(account.type).toBe('local')
    expect(account.source).toBe('mnemonic')
    expect(account.address).toBe(
      'aleo132x69f77mz7cx2f4s5wykktj73tj8cy7smdvxrgwja9qcmyuysxst42d9m',
    )
    console.log('  Mnemonic → address:', account.address)
    console.log('  Shield-derived account: PASS')
  })

  it('agent tools work against live chain', async () => {
    const tools = aleoAgentTools({ client: publicClient })
    expect(tools.length).toBeGreaterThan(0)

    // Call getBlockNumber tool
    const heightTool = tools.find(t => t.name === 'aleo_get_block_number')!
    const result = await heightTool.handler({})
    expect((result as any).height).toBeDefined()
    console.log('  aleo_get_block_number result:', JSON.stringify(result))

    // Call describe_program tool
    const describeTool = tools.find(t => t.name === 'aleo_describe_program')!
    const descResult = await describeTool.handler({ program: 'credits.aleo' }) as any
    expect(descResult.program).toBe('credits.aleo')
    expect(descResult.functions.length).toBeGreaterThan(0)
    expect(descResult.mappings.length).toBeGreaterThan(0)
    console.log('  aleo_describe_program: found', descResult.functions.length, 'functions,', descResult.mappings.length, 'mappings')
  })
}, { timeout: 30_000 })

// Inventory planning consumes the account's provider and performs no writes.
// A live application supplies createRemoteScanner({ waitForSync: true }) instead.
describe('Record inventory consumer example', () => {
  it('plans four credits records while keeping the source record private', async () => {
    const aleo = await loadNetwork('testnet')
    const account = aleo.generateAccount()
    const client = createWalletClient({
      account,
      transport: http(API_URL, { network: 'testnet' }),
      proving: aleo.createProvingConfig({ mode: 'delegated', networkUrl: API_URL, account }),
      // Routing and planning remain available without enabling reservations.
      recordManagement: { enabled: false, chainId: 'aleo:testnet', tokenJoin: { program: 'test_aj_arc20_2_15.aleo' } },
      recordProvider: { requestRecords: async () => [{
        programName: 'credits.aleo', recordName: 'credits', tag: '1field', spent: false,
        recordPlaintext: `{ owner: ${account.address}.private, microcredits: 4030000u64.private, _nonce: 1group.public }`,
      }] },
    })
    const plan = await client.planRecordInventory({
      asset: { program: 'credits.aleo', standard: 'credits' },
      target: { records: 4, distribution: 'balanced', minRecordAmount: 1_000_000n },
    })
    expect(client.recordManagement?.enabled).toBe(false)
    expect(client.recordManagement?.store).toBeUndefined()
    expect(plan.steps).toHaveLength(3)
    expect(plan.deduction).toBe(30_000n)
    expect(plan.inputs).toEqual([{ id: '1group', amount: 4_030_000n }])
  })
})
