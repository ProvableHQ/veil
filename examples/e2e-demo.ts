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
  http,
  parseProgram,
  getContract,
  isAddress,
} from '../packages/core/src/index.js'
import { aleoAgentTools } from '../packages/core/src/agent/index.js'
import { loadNetwork, type AleoSdk } from '../packages/provable/src/index.js'

const API_URL = 'https://api.provable.com/v2'

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

  it('readContract() reads a program mapping value', async () => {
    // Use committee mapping which has well-known validator entries
    // Note: 404 means the key doesn't exist in the mapping — handle gracefully
    try {
      const result = await publicClient.readContract({
        programId: 'credits.aleo',
        mapping: 'account',
        key: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      })
      console.log('  Mapping value:', result)
      // If we get here, the key exists
      expect(result).toBeDefined()
    } catch (e: any) {
      // 404 = key not found in mapping, which is valid behavior
      console.log('  Key not in mapping (404) — expected for this address')
      expect(e.message).toContain('404')
    }
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

    // Read through contract instance — use try/catch since 404 = key not found
    try {
      const value = await credits.read.account({
        key: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      })
      console.log('  credits.read.account():', value)
    } catch (e: any) {
      console.log('  credits.read.account(): key not found (404) — expected')
      expect(e.message).toContain('404')
    }

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
