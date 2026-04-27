import { describe, it, expect } from 'vitest'
import { generate } from '../src/generate.js'
import { parseAbi } from '@veil/core'
import type { ABI } from '@veil/core'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load real loyalty program ABIs for testing
const tokenAbiRaw = JSON.parse(readFileSync(join(__dirname, 'fixtures/loyalty_token_abi.json'), 'utf-8'))
const rewardsAbiRaw = JSON.parse(readFileSync(join(__dirname, 'fixtures/loyalty_rewards_abi.json'), 'utf-8'))
const ammAbiRaw = JSON.parse(readFileSync(join(__dirname, 'fixtures/amm_abi.json'), 'utf-8'))
const tokenAbi = parseAbi(tokenAbiRaw)
const rewardsAbi = parseAbi(rewardsAbiRaw)
const ammAbi = parseAbi(ammAbiRaw)

// ── Minimal ABI for isolated tests ────────────────────────────────────

const minimalAbi: ABI = {
  program: 'test.aleo',
  structs: [
    {
      path: ['Config'],
      fields: [
        { name: 'max_supply', type: { kind: 'primitive', primitive: 'u64' } },
        { name: 'admin', type: { kind: 'primitive', primitive: 'address' } },
        { name: 'active', type: { kind: 'primitive', primitive: 'boolean' } },
      ],
    },
  ],
  records: [
    {
      path: ['Token'],
      fields: [
        { name: 'owner', type: { kind: 'primitive', primitive: 'address' }, mode: 'private' },
        { name: 'amount', type: { kind: 'primitive', primitive: 'u64' }, mode: 'private' },
        { name: 'active', type: { kind: 'primitive', primitive: 'boolean' }, mode: 'private' },
      ],
    },
  ],
  mappings: [
    { name: 'balances', key: { kind: 'primitive', primitive: 'address' }, value: { kind: 'primitive', primitive: 'u64' } },
  ],
  storageVariables: [
    { name: 'total_supply', type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'u128' } } },
    { name: 'admins', type: { kind: 'vector', element: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'address' } } } },
  ],
  functions: [
    {
      name: 'mint',
      isFinal: true,
      inputs: [
        { name: 'recipient', type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'address' } }, mode: 'private' },
        { name: 'amount', type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'u64' } }, mode: 'private' },
      ],
      outputs: [
        { type: { kind: 'record', path: ['Token'], program: 'test' }, mode: 'private' },
        { type: { kind: 'final' }, mode: 'none' },
      ],
    },
    {
      name: 'transfer_to',
      isFinal: true,
      inputs: [
        { name: 'token', type: { kind: 'record', path: ['Token'], program: 'test' }, mode: 'private' },
        { name: 'recipient', type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'address' } }, mode: 'private' },
        { name: 'amount', type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'u64' } }, mode: 'private' },
      ],
      outputs: [
        { type: { kind: 'record', path: ['Token'], program: 'test' }, mode: 'private' },
        { type: { kind: 'record', path: ['Token'], program: 'test' }, mode: 'private' },
        { type: { kind: 'final' }, mode: 'none' },
      ],
    },
    {
      name: 'burn',
      isFinal: false,
      inputs: [
        { name: 'token', type: { kind: 'record', path: ['Token'], program: 'test' }, mode: 'private' },
      ],
      outputs: [
        { type: { kind: 'final' }, mode: 'none' },
      ],
    },
    {
      name: 'accept_any',
      isFinal: false,
      inputs: [
        { name: 'record', type: { kind: 'dynamicRecord' }, mode: 'private' },
      ],
      outputs: [
        { type: { kind: 'dynamicRecord' }, mode: 'private' },
      ],
    },
  ],
}

// ── ABI with advanced types ───────────────────────────────────────────

const advancedAbi: ABI = {
  program: 'advanced.aleo',
  structs: [
    {
      path: ['Vector3'],
      fields: [
        { name: 'x', type: { kind: 'primitive', primitive: 'field' } },
        { name: 'y', type: { kind: 'primitive', primitive: 'field' } },
        { name: 'z', type: { kind: 'primitive', primitive: 'field' } },
      ],
    },
    {
      path: ['Transform'],
      fields: [
        { name: 'position', type: { kind: 'struct', path: ['Vector3'], program: 'advanced.aleo' } },
        { name: 'scale', type: { kind: 'primitive', primitive: 'u32' } },
      ],
    },
  ],
  records: [
    {
      path: ['Checksum'],
      fields: [
        { name: 'data', type: { kind: 'array', element: { kind: 'primitive', primitive: 'u8' }, length: 32 }, mode: 'private' },
        { name: 'nested_array', type: { kind: 'array', element: { kind: 'array', element: { kind: 'primitive', primitive: 'u8' }, length: 3 }, length: 4 }, mode: 'private' },
        { name: 'valid', type: { kind: 'optional', inner: { kind: 'primitive', primitive: 'boolean' } }, mode: 'private' },
        { name: 'nested_optional', type: { kind: 'optional', inner: { kind: 'optional', inner: { kind: 'primitive', primitive: 'u64' } } }, mode: 'private' },
        { name: 'hash', type: { kind: 'primitive', primitive: 'field' }, mode: 'private' },
        { name: 'sig', type: { kind: 'primitive', primitive: 'signature' }, mode: 'private' },
        { name: 'id', type: { kind: 'primitive', primitive: 'identifier' }, mode: 'private' },
        { name: 'transform', type: { kind: 'struct', path: ['Transform'], program: 'advanced.aleo' }, mode: 'private' },
      ],
    },
  ],
  mappings: [],
  storageVariables: [],
  functions: [
    {
      name: 'verify',
      isFinal: false,
      inputs: [
        { name: 'checksum', type: { kind: 'plaintext', type: { kind: 'array', element: { kind: 'primitive', primitive: 'u8' }, length: 32 } }, mode: 'private' },
        { name: 'optional_flag', type: { kind: 'plaintext', type: { kind: 'optional', inner: { kind: 'primitive', primitive: 'boolean' } } }, mode: 'private' },
      ],
      outputs: [
        { type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'boolean' } }, mode: 'private' },
      ],
    },
  ],
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('generate', () => {
  describe('header', () => {
    it('includes program name and imports', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('Auto-generated by @veil/codegen from test.aleo')
      expect(output).toContain("import { getContract, parseAbi } from '@veil/core'")
      expect(output).toContain("import type { RecordValue, PublicClient, WalletClient, ContractInstance } from '@veil/core'")
      expect(output).toContain("export const PROGRAM_ID = 'test.aleo'")
    })

    it('uses custom core import path', () => {
      const output = generate({ abi: minimalAbi, coreImport: '../core' })
      expect(output).toContain("import { getContract, parseAbi } from '../core'")
    })
  })

  describe('struct interfaces', () => {
    it('generates interface from StructDef', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export interface Config {')
      expect(output).toContain('  max_supply: bigint')
      expect(output).toContain('  admin: string')
      expect(output).toContain('  active: boolean')
    })
  })

  describe('record interfaces', () => {
    it('generates interface with correct field types', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export interface Token {')
      expect(output).toContain('  owner: string')
      expect(output).toContain('  amount: bigint')
      expect(output).toContain('  active: boolean')
    })

    it('maps u8/u16/u32 to number', () => {
      const abi: ABI = {
        ...minimalAbi,
        records: [{
          path: ['SmallRecord'],
          fields: [
            { name: 'tier', type: { kind: 'primitive', primitive: 'u8' }, mode: 'private' },
            { name: 'level', type: { kind: 'primitive', primitive: 'u32' }, mode: 'private' },
          ],
        }],
      }
      const output = generate({ abi })
      expect(output).toContain('  tier: number')
      expect(output).toContain('  level: number')
    })
  })

  describe('record mappers', () => {
    it('generates toX mapper function', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export function toToken(record: RecordValue): Token {')
      expect(output).toContain('owner: record.owner')
      expect(output).toContain('record.fields.amount?.value as bigint')
      expect(output).toContain('record.fields.active?.value as boolean')
    })
  })

  describe('function input types', () => {
    it('generates input types for plaintext params', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export type MintInputs = {')
      expect(output).toContain('  recipient: string')
      expect(output).toContain('  amount: bigint')
    })

    it('generates input types for record params', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export type TransferToInputs = {')
      expect(output).toContain('  token: Token | RecordValue | string')
      expect(output).toContain('  recipient: string')
    })

    it('generates input types for dynamicRecord params', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export type AcceptAnyInputs = {')
      expect(output).toContain('  record: RecordValue | string')
    })
  })

  describe('function output types', () => {
    it('generates single record output type', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export type MintOutputs = Token')
    })

    it('generates tuple for multiple outputs', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export type TransferToOutputs = [Token, Token]')
    })

    it('generates void for finalize-only outputs', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export type BurnOutputs = void')
    })

    it('generates RecordValue for dynamicRecord outputs', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export type AcceptAnyOutputs = RecordValue')
    })
  })

  describe('mapping types', () => {
    it('generates key and value types', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export type BalancesMappingKey = string')
      expect(output).toContain('export type BalancesMappingValue = bigint')
    })
  })

  describe('storage variable types', () => {
    it('generates plaintext storage type', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export type TotalSupplyStorageType = bigint')
    })

    it('generates vector storage type', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export type AdminsStorageType = string[]')
    })
  })

  describe('advanced types', () => {
    it('generates array types', () => {
      const output = generate({ abi: advancedAbi })
      expect(output).toContain('  data: number[]')
    })

    it('generates optional types', () => {
      const output = generate({ abi: advancedAbi })
      expect(output).toContain('  valid: boolean | undefined')
    })

    it('generates field/signature/identifier as string', () => {
      const output = generate({ abi: advancedAbi })
      expect(output).toContain('  hash: string')
      expect(output).toContain('  sig: string')
      expect(output).toContain('  id: string')
    })

    it('generates array input types', () => {
      const output = generate({ abi: advancedAbi })
      expect(output).toContain('  checksum: number[]')
    })

    it('generates nested array types', () => {
      const output = generate({ abi: advancedAbi })
      expect(output).toContain('  nested_array: number[][]')
    })

    it('generates nested optional types', () => {
      const output = generate({ abi: advancedAbi })
      expect(output).toContain('  nested_optional: bigint | undefined | undefined')
    })

    it('generates struct field references', () => {
      const output = generate({ abi: advancedAbi })
      expect(output).toContain('  transform: Transform')
    })

    it('generates struct that references another struct', () => {
      const output = generate({ abi: advancedAbi })
      expect(output).toContain('export interface Transform {')
      expect(output).toContain('  position: Vector3')
      expect(output).toContain('  scale: number')
    })

    it('generates optional input types', () => {
      const output = generate({ abi: advancedAbi })
      expect(output).toContain('  optional_flag: boolean | undefined')
    })

    it('generates plaintext output type', () => {
      const output = generate({ abi: advancedAbi })
      expect(output).toContain('export type VerifyOutputs = boolean')
    })
  })

  describe('loyalty program ABIs', () => {
    it('generates from loyalty_token ABI', () => {
      const output = generate({ abi: tokenAbi })
      expect(output).toContain("PROGRAM_ID = 'loyalty_token.aleo'")
      expect(output).toContain('export interface LoyaltyCard {')
      expect(output).toContain('  points: bigint')
      expect(output).toContain('  tier: number')
      expect(output).toContain('export function toLoyaltyCard(record: RecordValue): LoyaltyCard {')
      expect(output).toContain('export type MintCardInputs = {')
      expect(output).toContain('export type MintCardOutputs = LoyaltyCard')
      expect(output).toContain('export type CardExistsMappingKey = string')
    })

    it('generates structs from loyalty_token ABI', () => {
      const output = generate({ abi: tokenAbi })
      // CardIdInput struct should be generated if present in the ABI
      if (tokenAbi.structs.length > 0) {
        const structName = tokenAbi.structs[0]!.path[tokenAbi.structs[0]!.path.length - 1]
        expect(output).toContain(`export interface ${structName} {`)
      }
    })

    it('generates from loyalty_rewards ABI', () => {
      const output = generate({ abi: rewardsAbi })
      expect(output).toContain("PROGRAM_ID = 'loyalty_rewards.aleo'")
      expect(output).toContain('export interface RewardVoucher {')
      expect(output).toContain('  reward_type: number')
      expect(output).toContain('  amount: bigint')
      expect(output).toContain('export function toRewardVoucher(record: RecordValue): RewardVoucher {')
      expect(output).toContain('export type RedeemPointsForVoucherInputs = {')
    })

    it('generates cross-program record input as RecordValue for imported records', () => {
      const output = generate({ abi: rewardsAbi })
      // redeem_points_for_voucher takes a LoyaltyCard from loyalty_token (foreign program)
      expect(output).toContain('RecordValue | RecordValue | string')
    })

    it('generated code contains no unknown types for known programs', () => {
      const tokenOutput = generate({ abi: tokenAbi })
      const rewardsOutput = generate({ abi: rewardsAbi })
      expect(tokenOutput).not.toMatch(/: unknown\b/)
      expect(rewardsOutput).not.toMatch(/: unknown\b/)
    })
  })

  describe('AMM program (real dynamic dispatch ABI from snarkVM)', () => {
    it('generates struct interface for reserves', () => {
      const output = generate({ abi: ammAbi })
      expect(output).toContain('export interface reserves {')
      expect(output).toContain('  token_a: bigint')
      expect(output).toContain('  token_b: bigint')
    })

    it('generates dynamicRecord input types from real ABI', () => {
      const output = generate({ abi: ammAbi })
      expect(output).toContain('export type BuyTokenBInputs = {')
      expect(output).toContain('  arg6: RecordValue | string') // dynamicRecord input
    })

    it('generates dynamicRecord output types from real ABI', () => {
      const output = generate({ abi: ammAbi })
      // buy_token_b returns two dynamic records (change + received token)
      expect(output).toContain('export type BuyTokenBOutputs = [RecordValue, RecordValue]')
    })

    it('generates struct-typed mapping value', () => {
      const output = generate({ abi: ammAbi })
      expect(output).toContain('export type ReservesMappingMappingKey = string') // address
      expect(output).toContain('export type ReservesMappingMappingValue = reserves') // struct reference
    })

    it('has no records (AMM uses dynamic records only)', () => {
      expect(ammAbi.records).toHaveLength(0)
      const output = generate({ abi: ammAbi })
      expect(output).not.toContain('export function to') // no record mappers
    })

    it('generated code contains no unknown types', () => {
      const output = generate({ abi: ammAbi })
      expect(output).not.toMatch(/: unknown\b/)
    })
  })

  describe('contract factory', () => {
    it('generates ABI_JSON constant', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export const ABI_JSON =')
      expect(output).toContain('"program": "test.aleo"')
    })

    it('generates factory function with correct name', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('export function createTestContract(')
      expect(output).toContain('publicClient?: PublicClient')
      expect(output).toContain('walletClient?: WalletClient')
      expect(output).toContain('): ContractInstance {')
    })

    it('factory calls getContract with parsed ABI', () => {
      const output = generate({ abi: minimalAbi })
      expect(output).toContain('const abi = parseAbi(ABI_JSON)')
      expect(output).toContain('return getContract({ program: PROGRAM_ID, abi, client })')
    })

    it('generates correct factory name from program ID', () => {
      const output = generate({ abi: tokenAbi })
      expect(output).toContain('export function createLoyaltyTokenContract(')
    })

    it('generates correct factory name for AMM', () => {
      const output = generate({ abi: ammAbi })
      expect(output).toContain('export function createAmmContract(')
    })
  })
})
