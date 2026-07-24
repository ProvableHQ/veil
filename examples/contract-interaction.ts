/**
 * Contract Interaction: the getContract() pattern
 *
 * This example shows how getContract() creates typed contract instances
 * that provide a high-level interface to Aleo programs — similar to
 * viem's getContract() for EVM smart contracts.
 *
 * Key features demonstrated:
 *   1. Fetching program source and parsing it into an ABI
 *   2. Creating a contract instance with typed read/write methods
 *   3. ABI validation — calling nonexistent methods throws helpful errors
 *   4. fetchAbi() for on-chain program discovery
 *   5. Dynamic proxies when no ABI is provided (quick prototyping)
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createPublicClient,
  createWalletClient,
  custom,
  rpcAccount,
  getContract,
  parseProgram,
} from '@provablehq/veil-core'
import type { Program } from '@provablehq/veil-core'

// ---------------------------------------------------------------------------
// Mock program source — a realistic subset of credits.aleo
// ---------------------------------------------------------------------------

const CREDITS_SOURCE = `program credits.aleo;

mapping account:
    key as address.public;
    value as u64.public;

mapping committee:
    key as address.public;
    value as u128.public;

function transfer_public:
    input r0 as address.public;
    input r1 as u64.public;

finalize transfer_public:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as u64.public;

function transfer_private:
    input r0 as credits.record;
    input r1 as address.private;
    input r2 as u64.private;

function bond_public:
    input r0 as address.public;
    input r1 as u64.public;

finalize bond_public:
    input r0 as address.public;
    input r1 as u64.public;
`

/** A custom token program to show getContract works with any program */
const TOKEN_SOURCE = `program my_token.aleo;

mapping balances:
    key as address.public;
    value as u64.public;

mapping total_supply:
    key as boolean.public;
    value as u64.public;

function mint:
    input r0 as address.public;
    input r1 as u64.public;

finalize mint:
    input r0 as address.public;
    input r1 as u64.public;

function burn:
    input r0 as u64.public;

finalize burn:
    input r0 as address.public;
    input r1 as u64.public;
`

// ---------------------------------------------------------------------------
// Mock transport
// ---------------------------------------------------------------------------

const MOCK_ADDRESS = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'
const MOCK_TX_ID = 'at1mock0000000000000000000000000000000000000000000000000000000'

const mockRequest = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
  const p = params as Record<string, unknown> | undefined
  switch (method) {
    case 'getProgram':
      // Return different sources based on the program being fetched
      if (p?.programId === 'credits.aleo') return CREDITS_SOURCE
      if (p?.programId === 'my_token.aleo') return TOKEN_SOURCE
      throw new Error(`Program not found: ${p?.programId}`)
    case 'getMappingValue':
      // Simulate different mapping values
      if (p?.mapping === 'account') return '5000000u64'
      if (p?.mapping === 'committee') return '1000000000000u128'
      if (p?.mapping === 'balances') return '100000u64'
      if (p?.mapping === 'total_supply') return '999999u64'
      return null
    case 'executeTransaction':
      return MOCK_TX_ID
    default:
      throw new Error(`Unhandled mock method: ${method}`)
  }
})

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const transport = custom({ request: mockRequest })

const publicClient = createPublicClient({ transport })

const walletClient = createWalletClient({
  account: rpcAccount({
    address: MOCK_ADDRESS,
    sign: async () => new Uint8Array([0]),
    signMessage: async () => new Uint8Array([0]),
  }),
  transport,
})

// ===========================================================================
// Tests
// ===========================================================================

describe('Contract Interaction: the getContract() pattern', () => {

  // -------------------------------------------------------------------------
  // Step 1: Parse program source into an ABI
  // -------------------------------------------------------------------------

  describe('Step 1: parseProgram() extracts a typed ABI', () => {
    it('parses credits.aleo into functions, mappings, and closures', () => {
      const abi = parseProgram(CREDITS_SOURCE)

      // Program identity
      expect(abi.id).toBe('credits.aleo')

      // Functions with their signatures
      expect(abi.functions).toHaveLength(3)
      const transferPublic = abi.functions.find((f) => f.name === 'transfer_public')!
      expect(transferPublic).toBeDefined()
      expect(transferPublic.inputs).toHaveLength(2)
      expect(transferPublic.inputs[0]).toEqual({
        kind: 'plaintext',
        name: 'r0',
        type: 'address',
        visibility: 'public',
      })
      expect(transferPublic.inputs[1]).toEqual({
        kind: 'plaintext',
        name: 'r1',
        type: 'u64',
        visibility: 'public',
      })
      expect(transferPublic.hasFinalize).toBe(true)

      // transfer_private has no finalize
      const transferPrivate = abi.functions.find((f) => f.name === 'transfer_private')!
      expect(transferPrivate.hasFinalize).toBe(false)

      // Mappings with key/value types
      expect(abi.mappings).toHaveLength(2)
      expect(abi.mappings[0]).toEqual({
        name: 'account',
        keyType: 'address',
        valueType: 'u64',
      })
      expect(abi.mappings[1]).toEqual({
        name: 'committee',
        keyType: 'address',
        valueType: 'u128',
      })
    })

    it('parses a custom token program', () => {
      const abi = parseProgram(TOKEN_SOURCE)

      expect(abi.id).toBe('my_token.aleo')
      expect(abi.functions).toHaveLength(2)
      expect(abi.functions.map((f) => f.name)).toEqual(['mint', 'burn'])
      expect(abi.mappings).toHaveLength(2)
      expect(abi.mappings.map((m) => m.name)).toEqual(['balances', 'total_supply'])
    })
  })

  // -------------------------------------------------------------------------
  // Step 2: Create a contract instance
  // -------------------------------------------------------------------------

  describe('Step 2: getContract() creates a typed contract instance', () => {
    const abi = parseProgram(CREDITS_SOURCE)

    it('binds to a program name and ABI', () => {
      const credits = getContract({
        program: 'credits.aleo',
        abi,
        client: publicClient,
      })

      expect(credits.program).toBe('credits.aleo')
      expect(credits.abi).toBeDefined()
      expect(credits.abi!.id).toBe('credits.aleo')
    })

    it('accepts both public and wallet clients via { public, wallet }', () => {
      const credits = getContract({
        program: 'credits.aleo',
        abi,
        client: { public: publicClient, wallet: walletClient },
      })

      // Both read and write are available
      expect(credits.read).toBeDefined()
      expect(credits.write).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // Step 3: Read mappings through the contract
  // -------------------------------------------------------------------------

  describe('Step 3: read mappings through typed methods', () => {
    const abi = parseProgram(CREDITS_SOURCE)
    const credits = getContract({
      program: 'credits.aleo',
      abi,
      client: publicClient,
    })

    it('reads the account mapping', async () => {
      const balance = await credits.read.account({ key: MOCK_ADDRESS })
      expect(balance).toBe('5000000u64')
    })

    it('reads the committee mapping', async () => {
      const stake = await credits.read.committee({ key: MOCK_ADDRESS })
      expect(stake).toBe('1000000000000u128')
    })

    it('works with a custom token program too', async () => {
      const tokenAbi = parseProgram(TOKEN_SOURCE)
      const token = getContract({
        program: 'my_token.aleo',
        abi: tokenAbi,
        client: publicClient,
      })

      const balance = await token.read.balances({ key: MOCK_ADDRESS })
      expect(balance).toBe('100000u64')

      const supply = await token.read.total_supply({ key: 'true' })
      expect(supply).toBe('999999u64')
    })
  })

  // -------------------------------------------------------------------------
  // Step 4: Write through the contract
  // -------------------------------------------------------------------------

  describe('Step 4: write through typed methods', () => {
    const abi = parseProgram(CREDITS_SOURCE)
    const credits = getContract({
      program: 'credits.aleo',
      abi,
      client: { public: publicClient, wallet: walletClient },
    })

    it('calls transfer_public through the contract', async () => {
      const txId = await credits.write.transfer_public({
        inputs: [MOCK_ADDRESS, '1000000u64'],
      })
      expect(txId).toBe(MOCK_TX_ID)
    })

    it('calls bond_public through the contract', async () => {
      const txId = await credits.write.bond_public({
        inputs: [MOCK_ADDRESS, '5000000u64'],
      })
      expect(txId).toBe(MOCK_TX_ID)
    })
  })

  // -------------------------------------------------------------------------
  // Step 5: ABI validation catches errors early
  // -------------------------------------------------------------------------

  describe('Step 5: ABI validation provides helpful errors', () => {
    const abi = parseProgram(CREDITS_SOURCE)

    it('throws when reading a nonexistent mapping', () => {
      const credits = getContract({
        program: 'credits.aleo',
        abi,
        client: publicClient,
      })

      // "balances" is not a mapping on credits.aleo
      expect(() => credits.read.balances({ key: MOCK_ADDRESS })).toThrow(
        'Mapping "balances" does not exist on program "credits.aleo"',
      )
    })

    it('error message lists available mappings', () => {
      const credits = getContract({
        program: 'credits.aleo',
        abi,
        client: publicClient,
      })

      try {
        credits.read.nonexistent({ key: 'test' })
      } catch (e: any) {
        expect(e.message).toContain('account')
        expect(e.message).toContain('committee')
      }
    })

    it('throws when calling a nonexistent function', () => {
      const credits = getContract({
        program: 'credits.aleo',
        abi,
        client: { public: publicClient, wallet: walletClient },
      })

      expect(() =>
        credits.write.mint_tokens({ inputs: ['100u64'] }),
      ).toThrow('Function "mint_tokens" does not exist on program "credits.aleo"')
    })

    it('error message lists available functions', () => {
      const credits = getContract({
        program: 'credits.aleo',
        abi,
        client: { public: publicClient, wallet: walletClient },
      })

      try {
        credits.write.nonexistent({ inputs: [] })
      } catch (e: any) {
        expect(e.message).toContain('transfer_public')
        expect(e.message).toContain('bond_public')
      }
    })

    it('throws helpful error when no public client for reads', () => {
      // A wallet-only contract cannot read mappings
      const credits = getContract({
        program: 'credits.aleo',
        abi,
        client: walletClient,
      })

      expect(() => credits.read.account({ key: MOCK_ADDRESS })).toThrow(
        'no public client provided',
      )
    })

    it('throws helpful error when no wallet client for writes', () => {
      // A read-only contract cannot call functions
      const credits = getContract({
        program: 'credits.aleo',
        abi,
        client: publicClient,
      })

      expect(() =>
        credits.write.transfer_public({ inputs: [MOCK_ADDRESS, '100u64'] }),
      ).toThrow('no wallet client provided')
    })
  })

  // -------------------------------------------------------------------------
  // Step 6: fetchAbi() for on-chain program discovery
  // -------------------------------------------------------------------------

  describe('Step 6: fetchAbi() discovers programs on-chain', () => {
    it('fetches and parses a program ABI from the chain', async () => {
      // Start with no ABI — useful when you know the program ID
      // but not its interface
      const credits = getContract({
        program: 'credits.aleo',
        client: publicClient,
      })

      // Initially, no ABI is set
      expect(credits.abi).toBeUndefined()

      // Fetch the ABI from the chain
      const abi = await credits.fetchAbi()

      // Now the contract knows the program's interface
      expect(abi.id).toBe('credits.aleo')
      expect(abi.functions.length).toBeGreaterThan(0)
      expect(abi.mappings.length).toBeGreaterThan(0)

      // And it's cached on the instance
      expect(credits.abi).toBe(abi)
    })

    it('without ABI, dynamic proxies allow any method name', async () => {
      // When no ABI is provided, getContract uses Proxy objects that
      // forward any method name — no validation. This is useful for
      // quick prototyping before you have the ABI.
      const credits = getContract({
        program: 'credits.aleo',
        client: publicClient,
      })

      // This works even though we haven't fetched the ABI
      const value = await credits.read.account({ key: MOCK_ADDRESS })
      expect(value).toBe('5000000u64')

      // Even made-up names pass through (they'd fail at the network level)
      // This is the trade-off: no compile-time safety without an ABI
    })

    it('fetchAbi() enables validation after the fact', async () => {
      const credits = getContract({
        program: 'credits.aleo',
        client: publicClient,
      })

      // Before fetchAbi: no validation, dynamic proxy
      // (any method name works)

      // Fetch and populate the ABI
      await credits.fetchAbi()

      // After fetchAbi: the internal ABI is populated, but note that
      // the Proxy was created at construction time. For full validation,
      // create a new instance with the fetched ABI:
      const validated = getContract({
        program: 'credits.aleo',
        abi: credits.abi!,
        client: publicClient,
      })

      // Now nonexistent methods throw
      expect(() => validated.read.nonexistent({ key: 'test' })).toThrow('does not exist')
    })
  })
})
