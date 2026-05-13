import { describe, it, expectTypeOf } from 'vitest'
import type {
  PrimitiveToTs,
  PlaintextToTs,
  OutputToTs,
  FunctionNames,
  MappingNames,
} from '../../src/types/inference.js'
import type { ABI } from '../../src/types/abi.js'
import type { RecordValue, FutureValue } from '../../src/types/primitives.js'
import { getContract, type ContractInstance } from '../../src/contract/getContract.js'
import { createPublicClient, custom } from '../../src/index.js'
import { vi } from 'vitest'

// ── Test ABI (literal type preserved via as const satisfies ABI) ─────

const testAbi = {
  program: 'test.aleo',
  structs: [
    {
      path: ['Config'],
      fields: [
        { name: 'max_supply', type: { kind: 'primitive', primitive: 'u64' } as const },
        { name: 'admin', type: { kind: 'primitive', primitive: 'address' } as const },
        { name: 'active', type: { kind: 'primitive', primitive: 'boolean' } as const },
      ],
    },
  ],
  records: [
    {
      path: ['Token'],
      fields: [
        { name: 'owner', type: { kind: 'primitive', primitive: 'address' } as const, mode: 'private' as const },
        { name: 'amount', type: { kind: 'primitive', primitive: 'u64' } as const, mode: 'private' as const },
      ],
    },
  ],
  mappings: [
    {
      name: 'balances',
      key: { kind: 'primitive', primitive: 'address' } as const,
      value: { kind: 'primitive', primitive: 'u64' } as const,
    },
    {
      name: 'total_supply',
      key: { kind: 'primitive', primitive: 'field' } as const,
      value: { kind: 'primitive', primitive: 'u128' } as const,
    },
  ],
  storageVariables: [],
  functions: [
    {
      name: 'mint',
      isFinal: true,
      inputs: [
        { name: 'recipient', type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'address' } as const } as const, mode: 'private' as const },
        { name: 'amount', type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'u64' } as const } as const, mode: 'private' as const },
      ],
      outputs: [
        { type: { kind: 'record', path: ['Token'], program: 'test' } as const, mode: 'private' as const },
        { type: { kind: 'future' } as const, mode: 'none' as const },
      ],
    },
    {
      name: 'transfer',
      isFinal: true,
      inputs: [
        { name: 'token', type: { kind: 'record', path: ['Token'], program: 'test' } as const, mode: 'private' as const },
        { name: 'recipient', type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'address' } as const } as const, mode: 'private' as const },
      ],
      outputs: [
        { type: { kind: 'record', path: ['Token'], program: 'test' } as const, mode: 'private' as const },
        { type: { kind: 'record', path: ['Token'], program: 'test' } as const, mode: 'private' as const },
        { type: { kind: 'future' } as const, mode: 'none' as const },
      ],
    },
    {
      name: 'get_balance',
      isFinal: false,
      inputs: [
        { name: 'addr', type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'address' } as const } as const, mode: 'private' as const },
      ],
      outputs: [
        { type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'u64' } as const } as const, mode: 'private' as const },
      ],
    },
  ],
} as const satisfies ABI

// ── Type-level tests ─────────────────────────────────────────────────

describe('type-level inference', () => {
  describe('PrimitiveToTs', () => {
    it('maps integer types correctly', () => {
      expectTypeOf<PrimitiveToTs<'u8'>>().toEqualTypeOf<number>()
      expectTypeOf<PrimitiveToTs<'u16'>>().toEqualTypeOf<number>()
      expectTypeOf<PrimitiveToTs<'u32'>>().toEqualTypeOf<number>()
      expectTypeOf<PrimitiveToTs<'i8'>>().toEqualTypeOf<number>()
      expectTypeOf<PrimitiveToTs<'i16'>>().toEqualTypeOf<number>()
      expectTypeOf<PrimitiveToTs<'i32'>>().toEqualTypeOf<number>()
    })

    it('maps bigint types correctly', () => {
      expectTypeOf<PrimitiveToTs<'u64'>>().toEqualTypeOf<bigint>()
      expectTypeOf<PrimitiveToTs<'u128'>>().toEqualTypeOf<bigint>()
      expectTypeOf<PrimitiveToTs<'i64'>>().toEqualTypeOf<bigint>()
      expectTypeOf<PrimitiveToTs<'i128'>>().toEqualTypeOf<bigint>()
    })

    it('maps string types correctly', () => {
      expectTypeOf<PrimitiveToTs<'address'>>().toEqualTypeOf<string>()
      expectTypeOf<PrimitiveToTs<'field'>>().toEqualTypeOf<string>()
      expectTypeOf<PrimitiveToTs<'group'>>().toEqualTypeOf<string>()
      expectTypeOf<PrimitiveToTs<'scalar'>>().toEqualTypeOf<string>()
      expectTypeOf<PrimitiveToTs<'signature'>>().toEqualTypeOf<string>()
      expectTypeOf<PrimitiveToTs<'identifier'>>().toEqualTypeOf<string>()
    })

    it('maps boolean correctly', () => {
      expectTypeOf<PrimitiveToTs<'boolean'>>().toEqualTypeOf<boolean>()
    })
  })

  describe('PlaintextToTs', () => {
    it('maps primitive plaintext', () => {
      type Result = PlaintextToTs<{ kind: 'primitive'; primitive: 'u64' }>
      expectTypeOf<Result>().toEqualTypeOf<bigint>()
    })

    it('maps array plaintext', () => {
      type Result = PlaintextToTs<{ kind: 'array'; element: { kind: 'primitive'; primitive: 'u8' }; length: 32 }>
      expectTypeOf<Result>().toEqualTypeOf<number[]>()
    })

    it('maps optional plaintext', () => {
      type Result = PlaintextToTs<{ kind: 'optional'; inner: { kind: 'primitive'; primitive: 'boolean' } }>
      expectTypeOf<Result>().toEqualTypeOf<boolean | undefined>()
    })

    it('maps struct to Record when no ABI provided', () => {
      type Result = PlaintextToTs<{ kind: 'struct'; path: ['Config'] }>
      expectTypeOf<Result>().toEqualTypeOf<Record<string, unknown>>()
    })

    it('resolves struct fields when ABI is provided', () => {
      type Result = PlaintextToTs<{ kind: 'struct'; path: ['Config'] }, typeof testAbi>
      expectTypeOf<Result>().toEqualTypeOf<{ max_supply: bigint; admin: string; active: boolean }>()
    })

    it('resolves nested structs up to depth limit', () => {
      // 5-level deep nesting: L1 → L2 → L3 → L4 → L5
      const nestedAbi = {
        program: 'nested.aleo',
        structs: [
          { path: ['L5'], fields: [{ name: 'value', type: { kind: 'primitive', primitive: 'u64' } as const }] },
          { path: ['L4'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L5'] } as const }] },
          { path: ['L3'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L4'] } as const }] },
          { path: ['L2'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L3'] } as const }] },
          { path: ['L1'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L2'] } as const }] },
        ],
        records: [],
        mappings: [],
        storageVariables: [],
        functions: [],
      } as const satisfies ABI

      // Level 1: should resolve L1 → L2 → L3 → L4 → L5.value
      type L1 = PlaintextToTs<{ kind: 'struct'; path: ['L1'] }, typeof nestedAbi>
      expectTypeOf<L1>().toEqualTypeOf<{ inner: { inner: { inner: { inner: { value: bigint } } } } }>()
    })

    it('resolves 8 levels of nested structs (max depth)', () => {
      const deepAbi = {
        program: 'deep.aleo',
        structs: [
          { path: ['L8'], fields: [{ name: 'value', type: { kind: 'primitive', primitive: 'u64' } as const }] },
          { path: ['L7'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L8'] } as const }] },
          { path: ['L6'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L7'] } as const }] },
          { path: ['L5'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L6'] } as const }] },
          { path: ['L4'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L5'] } as const }] },
          { path: ['L3'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L4'] } as const }] },
          { path: ['L2'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L3'] } as const }] },
          { path: ['L1'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L2'] } as const }] },
        ],
        records: [], mappings: [], storageVariables: [], functions: [],
      } as const satisfies ABI

      // All 8 levels should resolve — deepest field is bigint
      type L1 = PlaintextToTs<{ kind: 'struct'; path: ['L1'] }, typeof deepAbi>
      type Deepest = L1['inner']['inner']['inner']['inner']['inner']['inner']['inner']
      expectTypeOf<Deepest>().toEqualTypeOf<{ value: bigint }>()
    })

    it('falls back to Record beyond depth limit (9 levels, max 8)', () => {
      const deepAbi = {
        program: 'deep.aleo',
        structs: [
          { path: ['L9'], fields: [{ name: 'value', type: { kind: 'primitive', primitive: 'u64' } as const }] },
          { path: ['L8'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L9'] } as const }] },
          { path: ['L7'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L8'] } as const }] },
          { path: ['L6'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L7'] } as const }] },
          { path: ['L5'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L6'] } as const }] },
          { path: ['L4'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L5'] } as const }] },
          { path: ['L3'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L4'] } as const }] },
          { path: ['L2'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L3'] } as const }] },
          { path: ['L1'], fields: [{ name: 'inner', type: { kind: 'struct', path: ['L2'] } as const }] },
        ],
        records: [], mappings: [], storageVariables: [], functions: [],
      } as const satisfies ABI

      // Level 9 exceeds MaxDepth of 8 — innermost becomes Record<string, unknown>
      type L1 = PlaintextToTs<{ kind: 'struct'; path: ['L1'] }, typeof deepAbi>
      type AtDepthLimit = L1['inner']['inner']['inner']['inner']['inner']['inner']['inner']
      expectTypeOf<AtDepthLimit>().toEqualTypeOf<{ inner: Record<string, unknown> }>()
    })
  })

  describe('OutputToTs', () => {
    it('maps record output to RecordValue', () => {
      type Result = OutputToTs<{ kind: 'record'; path: ['Token']; program: 'test' }>
      expectTypeOf<Result>().toEqualTypeOf<RecordValue>()
    })

    it('maps plaintext output to primitive', () => {
      type Result = OutputToTs<{ kind: 'plaintext'; type: { kind: 'primitive'; primitive: 'u64' } }>
      expectTypeOf<Result>().toEqualTypeOf<bigint>()
    })

    it('maps future output to FutureValue', () => {
      type Result = OutputToTs<{ kind: 'future' }>
      expectTypeOf<Result>().toEqualTypeOf<FutureValue>()
    })

    it('maps dynamicFuture output to FutureValue', () => {
      type Result = OutputToTs<{ kind: 'dynamicFuture' }>
      expectTypeOf<Result>().toEqualTypeOf<FutureValue>()
    })

    it('maps dynamicRecord to RecordValue', () => {
      type Result = OutputToTs<{ kind: 'dynamicRecord' }>
      expectTypeOf<Result>().toEqualTypeOf<RecordValue>()
    })
  })

  describe('FunctionNames / MappingNames', () => {
    it('extracts function names as literal union', () => {
      type Names = FunctionNames<typeof testAbi>
      expectTypeOf<Names>().toEqualTypeOf<'mint' | 'transfer' | 'get_balance'>()
    })

    it('extracts mapping names as literal union', () => {
      type Names = MappingNames<typeof testAbi>
      expectTypeOf<Names>().toEqualTypeOf<'balances' | 'total_supply'>()
    })

    it('widened ABI produces string (no narrowing)', () => {
      type Names = FunctionNames<ABI>
      expectTypeOf<Names>().toEqualTypeOf<string>()
    })
  })

  describe('getContract with literal ABI', () => {
    it('narrows simulate method names and rejects invalid ones', () => {
      const mockRequest = vi.fn().mockResolvedValue('ok')
      const publicClient = createPublicClient({ transport: custom({ request: mockRequest }) })

      const contract = getContract({
        program: 'test.aleo',
        abi: testAbi,
        client: publicClient,
      })

      // Valid names exist
      expectTypeOf(contract.simulate.mint).toBeFunction()
      expectTypeOf(contract.simulate.transfer).toBeFunction()
      expectTypeOf(contract.simulate.get_balance).toBeFunction()

      // Invalid names produce TS errors
      // @ts-expect-error — 'nonexistent' is not a function in the ABI
      contract.simulate.nonexistent
    })

    it('narrows read method names and rejects invalid ones', () => {
      const mockRequest = vi.fn().mockResolvedValue('ok')
      const publicClient = createPublicClient({ transport: custom({ request: mockRequest }) })

      const contract = getContract({
        program: 'test.aleo',
        abi: testAbi,
        client: publicClient,
      })

      expectTypeOf(contract.read.balances).toBeFunction()
      expectTypeOf(contract.read.total_supply).toBeFunction()

      // @ts-expect-error — 'unknown_mapping' is not a mapping in the ABI
      contract.read.unknown_mapping
    })

    it('narrows write and execute method names', () => {
      const mockRequest = vi.fn().mockResolvedValue('ok')
      const publicClient = createPublicClient({ transport: custom({ request: mockRequest }) })

      const contract = getContract({
        program: 'test.aleo',
        abi: testAbi,
        client: publicClient,
      })

      expectTypeOf(contract.write.mint).toBeFunction()
      expectTypeOf(contract.execute.mint).toBeFunction()
    })

    it('fetchAbi returns Promise<Program> on typed contract', () => {
      const mockRequest = vi.fn().mockResolvedValue('ok')
      const publicClient = createPublicClient({ transport: custom({ request: mockRequest }) })

      const contract = getContract({
        program: 'test.aleo',
        abi: testAbi,
        client: publicClient,
      })

      expectTypeOf(contract.fetchAbi).returns.resolves.not.toBeUnknown()
    })
  })

  describe('getContract with widened ABI falls back gracefully', () => {
    it('returns ContractInstance with widened ABI', () => {
      const mockRequest = vi.fn().mockResolvedValue('ok')
      const publicClient = createPublicClient({ transport: custom({ request: mockRequest }) })

      const widenedAbi: ABI = testAbi
      const contract = getContract({
        program: 'test.aleo',
        abi: widenedAbi,
        client: publicClient,
      })

      // Widened ABI returns untyped ContractInstance — any string key valid
      expectTypeOf(contract).toEqualTypeOf<ContractInstance>()
    })

    it('works without ABI', () => {
      const mockRequest = vi.fn().mockResolvedValue('ok')
      const publicClient = createPublicClient({ transport: custom({ request: mockRequest }) })

      const contract = getContract({
        program: 'test.aleo',
        client: publicClient,
      })

      // No ABI — untyped ContractInstance
      expectTypeOf(contract.simulate).toBeObject()
    })
  })
})
