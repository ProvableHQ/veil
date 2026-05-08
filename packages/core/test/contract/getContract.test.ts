import { describe, it, expect, vi } from 'vitest'
import { getContract } from '../../src/contract/getContract.js'
import { createPublicClient } from '../../src/clients/createPublicClient.js'
import { custom } from '../../src/transports/custom.js'
import type { Program } from '../../src/types/program.js'
import type { RecordValue } from '../../src/types/primitives.js'

describe('getContract', () => {
  it('allows any method when no abi provided', async () => {
    const request = vi.fn().mockResolvedValue('100u64')
    const client = createPublicClient({ transport: custom({ request }) })

    const contract = getContract({ program: 'token.aleo', client })
    await contract.read.anyMapping({ key: 'aleo1abc' })

    expect(request).toHaveBeenCalledWith({
      method: 'getMappingValue',
      params: { programId: 'token.aleo', mapping: 'anyMapping', key: 'aleo1abc' },
    })
  })

  it('validates mapping names when abi provided', () => {
    const request = vi.fn()
    const client = createPublicClient({ transport: custom({ request }) })

    const abi: Program = {
      id: 'token.aleo',
      source: '',
      mappings: [{ name: 'balances', keyType: 'address', valueType: 'u64' }],
      functions: [{ name: 'transfer', inputs: [], outputs: [], hasFinalize: true }],
      closures: [],
    }

    const contract = getContract({ program: 'token.aleo', abi, client })

    expect(() => contract.read.nonexistent({ key: 'aleo1abc' })).toThrow(
      'Mapping "nonexistent" does not exist',
    )
  })

  it('validates function names when abi provided', () => {
    const request = vi.fn()
    const client = createPublicClient({ transport: custom({ request }) })

    const abi: Program = {
      id: 'token.aleo',
      source: '',
      mappings: [],
      functions: [{ name: 'transfer', inputs: [], outputs: [], hasFinalize: false }],
      closures: [],
    }

    // getContract needs a wallet client for write — test the error path
    const contract = getContract({ program: 'token.aleo', abi, client })
    expect(() => contract.write.transfer({ inputs: [] })).toThrow('no wallet client provided')
  })

  it('throws when reading without public client', () => {
    const request = vi.fn()
    const mockWallet = {
      writeContract: vi.fn(),
      simulateContract: vi.fn(),
      executeTransaction: vi.fn(),
      key: 'wallet',
      name: 'test',
      request,
      transport: { config: {} as any, request },
      uid: 'test',
      extend: vi.fn(),
      account: { type: 'rpc' as const, address: 'aleo1abc', sign: vi.fn(), signMessage: vi.fn() },
      proving: undefined,
      records: undefined,
      sendTransaction: vi.fn(),
      deployContract: vi.fn(),
      signMessage: vi.fn(),
      transfer: vi.fn(),
      decrypt: vi.fn(),
      requestRecords: vi.fn(),
    }

    const contract = getContract({ program: 'token.aleo', client: mockWallet as any })
    expect(() => contract.read.balances({ key: 'aleo1abc' })).toThrow('no public client provided')
  })

  it('simulate proxy delegates to walletClient.simulateContract', async () => {
    const simulateContract = vi.fn().mockResolvedValue({ outputs: ['100u64'] })
    const mockWallet = {
      writeContract: vi.fn(),
      simulateContract,
      executeTransaction: vi.fn(),
      key: 'wallet', name: 'test',
      request: vi.fn(), transport: { config: {} as any, request: vi.fn() },
      uid: 'test', extend: vi.fn(),
      account: { type: 'local' as const, source: 'privateKey', address: 'aleo1abc', privateKey: 'pk', viewKey: 'vk', sign: vi.fn(), signMessage: vi.fn() },
      proving: { mode: 'local' as const, simulate: vi.fn() },
      records: undefined,
      sendTransaction: vi.fn(), deployContract: vi.fn(), signMessage: vi.fn(),
      transfer: vi.fn(), decrypt: vi.fn(), requestRecords: vi.fn(),
    }

    const contract = getContract({
      program: 'token.aleo',
      programSource: 'program token.aleo;',
      imports: { 'credits.aleo': 'program credits.aleo;' },
      client: mockWallet as any,
    })

    await contract.simulate.mint({ inputs: ['aleo1abc', '100u64'] })

    expect(simulateContract).toHaveBeenCalledWith({
      program: 'token.aleo',
      function: 'mint',
      inputs: ['aleo1abc', '100u64'],
      programSource: 'program token.aleo;',
      imports: { 'credits.aleo': 'program credits.aleo;' },
    })
  })

  it('execute proxy delegates to walletClient.executeTransaction', async () => {
    const executeTransaction = vi.fn().mockResolvedValue({ transactionId: 'tx1', outputs: ['100u64'] })
    const mockWallet = {
      writeContract: vi.fn(),
      simulateContract: vi.fn(),
      executeTransaction,
      key: 'wallet', name: 'test',
      request: vi.fn(), transport: { config: {} as any, request: vi.fn() },
      uid: 'test', extend: vi.fn(),
      account: { type: 'local' as const, source: 'privateKey', address: 'aleo1abc', privateKey: 'pk', viewKey: 'vk', sign: vi.fn(), signMessage: vi.fn() },
      proving: { mode: 'local' as const },
      records: undefined,
      sendTransaction: vi.fn(), deployContract: vi.fn(), signMessage: vi.fn(),
      transfer: vi.fn(), decrypt: vi.fn(), requestRecords: vi.fn(),
    }

    const contract = getContract({
      program: 'token.aleo',
      programSource: 'program token.aleo;',
      client: mockWallet as any,
    })

    await contract.execute.mint({ inputs: ['aleo1abc', '100u64'] })

    expect(executeTransaction).toHaveBeenCalledWith({
      program: 'token.aleo',
      function: 'mint',
      inputs: ['aleo1abc', '100u64'],
      programSource: 'program token.aleo;',
      imports: {},
    })
  })

  it('simulate validates function names against ABI', async () => {
    const mockWallet = {
      writeContract: vi.fn(), simulateContract: vi.fn(), executeTransaction: vi.fn(),
      key: 'wallet', name: 'test',
      request: vi.fn(), transport: { config: {} as any, request: vi.fn() },
      uid: 'test', extend: vi.fn(),
      account: { type: 'local' as const, source: 'privateKey', address: 'aleo1abc', privateKey: 'pk', viewKey: 'vk', sign: vi.fn(), signMessage: vi.fn() },
      proving: { mode: 'local' as const },
      records: undefined,
      sendTransaction: vi.fn(), deployContract: vi.fn(), signMessage: vi.fn(),
      transfer: vi.fn(), decrypt: vi.fn(), requestRecords: vi.fn(),
    }

    const abi: Program = {
      id: 'token.aleo', source: '', closures: [],
      mappings: [], functions: [{ name: 'mint', inputs: [], outputs: [], hasFinalize: false }],
    }

    const contract = getContract({ program: 'token.aleo', abi, client: mockWallet as any })
    await expect(contract.simulate.nonexistent({ inputs: [] })).rejects.toThrow('Function "nonexistent" does not exist')
  })

  it('simulate and execute throw without wallet client', () => {
    const request = vi.fn()
    const client = createPublicClient({ transport: custom({ request }) })
    const contract = getContract({ program: 'token.aleo', client })

    // These throw synchronously because the wallet check is before the async body
    expect(() => contract.simulate.mint({ inputs: [] })).toThrow('no wallet client provided')
    expect(() => contract.execute.mint({ inputs: [] })).toThrow('no wallet client provided')
  })

  it('simulate auto-encodes native inputs and auto-parses record outputs', async () => {
    const simulateContract = vi.fn().mockResolvedValue({
      outputs: ['{ owner: aleo1abc.private, amount: 500u64.private, _nonce: 0group.public }'],
    })
    const mockWallet = {
      writeContract: vi.fn(), simulateContract, executeTransaction: vi.fn(),
      key: 'wallet', name: 'test',
      request: vi.fn(), transport: { config: {} as any, request: vi.fn() },
      uid: 'test', extend: vi.fn(),
      account: { type: 'local' as const, source: 'privateKey', address: 'aleo1abc', privateKey: 'pk', viewKey: 'vk', sign: vi.fn(), signMessage: vi.fn() },
      proving: { mode: 'local' as const, simulate: vi.fn() },
      records: undefined,
      sendTransaction: vi.fn(), deployContract: vi.fn(), signMessage: vi.fn(),
      transfer: vi.fn(), decrypt: vi.fn(), requestRecords: vi.fn(),
    }

    const abi: Program = {
      id: 'token.aleo', source: '', closures: [],
      mappings: [],
      functions: [{
        name: 'mint',
        inputs: [
          { name: 'recipient', type: 'address', visibility: 'private' as const },
          { name: 'amount', type: 'u64', visibility: 'private' as const },
        ],
        outputs: [{ type: 'Token', visibility: 'private' as const }],
        hasFinalize: false,
      }],
    }

    const contract = getContract({
      program: 'token.aleo',
      abi,
      programSource: 'program token.aleo;',
      client: mockWallet as any,
    })

    // Pass native values — should be auto-encoded
    const result = await contract.simulate.mint({
      inputs: ['aleo1abc', 1000n],
    })

    // Inputs should have been encoded
    expect(simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: ['aleo1abc', '1000u64'],
      }),
    )

    // Output should be a parsed RecordValue, not a raw string
    const output = result.outputs[0]
    expect(typeof output).not.toBe('string')
    expect((output as RecordValue).owner).toBe('aleo1abc')
    expect((output as RecordValue).fields.amount?.value).toBe(500n)
  })

  it('auto-encodes RecordValue inputs via serializeRecord', async () => {
    const simulateContract = vi.fn().mockResolvedValue({ outputs: [] })
    const mockWallet = {
      writeContract: vi.fn(), simulateContract, executeTransaction: vi.fn(),
      key: 'wallet', name: 'test',
      request: vi.fn(), transport: { config: {} as any, request: vi.fn() },
      uid: 'test', extend: vi.fn(),
      account: { type: 'local' as const, source: 'privateKey', address: 'aleo1abc', privateKey: 'pk', viewKey: 'vk', sign: vi.fn(), signMessage: vi.fn() },
      proving: { mode: 'local' as const },
      records: undefined,
      sendTransaction: vi.fn(), deployContract: vi.fn(), signMessage: vi.fn(),
      transfer: vi.fn(), decrypt: vi.fn(), requestRecords: vi.fn(),
    }

    const record: RecordValue = {
      owner: 'aleo1abc',
      program: 'token.aleo',
      recordName: 'Token',
      fields: {
        amount: { value: 500n, mode: 'private', type: { kind: 'primitive', primitive: 'u64' } },
      },
      nonce: '0group',
    }

    const contract = getContract({ program: 'token.aleo', client: mockWallet as any })
    await contract.simulate.transfer({ inputs: [record, 'aleo1xyz'] })

    const calledInputs = simulateContract.mock.calls[0][0].inputs
    expect(calledInputs[0]).toContain('owner: aleo1abc.private')
    expect(calledInputs[0]).toContain('amount: 500u64.private')
    expect(calledInputs[1]).toBe('aleo1xyz')
  })

  it('auto-encodes booleans and numbers', async () => {
    const simulateContract = vi.fn().mockResolvedValue({ outputs: [] })
    const mockWallet = {
      writeContract: vi.fn(), simulateContract, executeTransaction: vi.fn(),
      key: 'wallet', name: 'test',
      request: vi.fn(), transport: { config: {} as any, request: vi.fn() },
      uid: 'test', extend: vi.fn(),
      account: { type: 'local' as const, source: 'privateKey', address: 'aleo1abc', privateKey: 'pk', viewKey: 'vk', sign: vi.fn(), signMessage: vi.fn() },
      proving: { mode: 'local' as const },
      records: undefined,
      sendTransaction: vi.fn(), deployContract: vi.fn(), signMessage: vi.fn(),
      transfer: vi.fn(), decrypt: vi.fn(), requestRecords: vi.fn(),
    }

    const abi: Program = {
      id: 'token.aleo', source: '', closures: [],
      mappings: [],
      functions: [{
        name: 'set_active',
        inputs: [
          { name: 'active', type: 'boolean', visibility: 'private' as const },
          { name: 'tier', type: 'u8', visibility: 'private' as const },
        ],
        outputs: [],
        hasFinalize: false,
      }],
    }

    const contract = getContract({ program: 'token.aleo', abi, client: mockWallet as any })
    await contract.simulate.set_active({ inputs: [true, 2] })

    const calledInputs = simulateContract.mock.calls[0][0].inputs
    expect(calledInputs[0]).toBe('true')
    expect(calledInputs[1]).toBe('2u8')
  })

  it('non-record outputs stay as strings', async () => {
    const simulateContract = vi.fn().mockResolvedValue({
      outputs: ['42u64', 'true'],
    })
    const mockWallet = {
      writeContract: vi.fn(), simulateContract, executeTransaction: vi.fn(),
      key: 'wallet', name: 'test',
      request: vi.fn(), transport: { config: {} as any, request: vi.fn() },
      uid: 'test', extend: vi.fn(),
      account: { type: 'local' as const, source: 'privateKey', address: 'aleo1abc', privateKey: 'pk', viewKey: 'vk', sign: vi.fn(), signMessage: vi.fn() },
      proving: { mode: 'local' as const },
      records: undefined,
      sendTransaction: vi.fn(), deployContract: vi.fn(), signMessage: vi.fn(),
      transfer: vi.fn(), decrypt: vi.fn(), requestRecords: vi.fn(),
    }

    const contract = getContract({ program: 'token.aleo', client: mockWallet as any })
    const result = await contract.simulate.check({ inputs: [] })

    expect(result.outputs[0]).toBe('42u64')
    expect(result.outputs[1]).toBe('true')
  })

  it('execute auto-parses outputs with transactionId', async () => {
    const executeTransaction = vi.fn().mockResolvedValue({
      transactionId: 'tx123',
      outputs: ['{ owner: aleo1abc.private, points: 1000u64.private, _nonce: 0group.public }'],
    })
    const mockWallet = {
      writeContract: vi.fn(), simulateContract: vi.fn(), executeTransaction,
      key: 'wallet', name: 'test',
      request: vi.fn(), transport: { config: {} as any, request: vi.fn() },
      uid: 'test', extend: vi.fn(),
      account: { type: 'local' as const, source: 'privateKey', address: 'aleo1abc', privateKey: 'pk', viewKey: 'vk', sign: vi.fn(), signMessage: vi.fn() },
      proving: { mode: 'local' as const },
      records: undefined,
      sendTransaction: vi.fn(), deployContract: vi.fn(), signMessage: vi.fn(),
      transfer: vi.fn(), decrypt: vi.fn(), requestRecords: vi.fn(),
    }

    const contract = getContract({ program: 'token.aleo', client: mockWallet as any })
    const result = await contract.execute.mint({ inputs: ['aleo1abc', '1000u64'] })

    expect(result.transactionId).toBe('tx123')
    expect(typeof result.outputs[0]).not.toBe('string')
    expect((result.outputs[0] as RecordValue).owner).toBe('aleo1abc')
    expect((result.outputs[0] as RecordValue).fields.points?.value).toBe(1000n)
  })

  it('write returns raw tx ID without auto-parsing', async () => {
    const writeContract = vi.fn().mockResolvedValue('txid_abc')
    const mockWallet = {
      writeContract, simulateContract: vi.fn(), executeTransaction: vi.fn(),
      key: 'wallet', name: 'test',
      request: vi.fn(), transport: { config: {} as any, request: vi.fn() },
      uid: 'test', extend: vi.fn(),
      account: { type: 'local' as const, source: 'privateKey', address: 'aleo1abc', privateKey: 'pk', viewKey: 'vk', sign: vi.fn(), signMessage: vi.fn() },
      proving: { mode: 'local' as const },
      records: undefined,
      sendTransaction: vi.fn(), deployContract: vi.fn(), signMessage: vi.fn(),
      transfer: vi.fn(), decrypt: vi.fn(), requestRecords: vi.fn(),
    }

    const contract = getContract({ program: 'token.aleo', client: mockWallet as any })
    const result = await contract.write.mint({ inputs: ['aleo1abc', '1000u64'] })

    expect(result).toBe('txid_abc')
  })

  it('accepts ABI type and uses encodeInputs with Plaintext types', async () => {
    const simulateContract = vi.fn().mockResolvedValue({ outputs: [] })
    const mockWallet = {
      writeContract: vi.fn(), simulateContract, executeTransaction: vi.fn(),
      key: 'wallet', name: 'test',
      request: vi.fn(), transport: { config: {} as any, request: vi.fn() },
      uid: 'test', extend: vi.fn(),
      account: { type: 'local' as const, source: 'privateKey', address: 'aleo1abc', privateKey: 'pk', viewKey: 'vk', sign: vi.fn(), signMessage: vi.fn() },
      proving: { mode: 'local' as const },
      records: undefined,
      sendTransaction: vi.fn(), deployContract: vi.fn(), signMessage: vi.fn(),
      transfer: vi.fn(), decrypt: vi.fn(), requestRecords: vi.fn(),
    }

    const { parseAbi } = await import('../../src/utils/parseAbi.js')
    const { readFileSync } = await import('fs')
    const { join, dirname } = await import('path')
    const { fileURLToPath } = await import('url')
    const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../../codegen/test/fixtures')
    const tokenAbiRaw = JSON.parse(readFileSync(join(fixturesDir, 'loyalty_token_abi.json'), 'utf-8'))
    const tokenAbi = parseAbi(tokenAbiRaw)

    const contract = getContract({
      program: 'loyalty_token.aleo',
      abi: tokenAbi,
      client: mockWallet as any,
    })

    await contract.simulate.mint_card({ inputs: ['aleo1abc', 1000n, 42n] })

    const calledInputs = simulateContract.mock.calls[0][0].inputs
    expect(calledInputs[0]).toBe('aleo1abc')
    expect(calledInputs[1]).toBe('1000u64')
    expect(calledInputs[2]).toBe('42field')
  })
})

describe('getContract execute proxy — per-transition outputs', () => {
  it('returns structured transitions from execute result', async () => {
    const executeTransaction = vi.fn().mockResolvedValue({
      transactionId: 'at1abc',
      transitions: [
        {
          transitionId: 'au1first',
          program: 'token.aleo',
          function: 'mint',
          outputs: ['{\n  owner: aleo1abc.private,\n  amount: 1000u64.private,\n  _nonce: 123group.public\n}'],
        },
      ],
      outputs: ['{\n  owner: aleo1abc.private,\n  amount: 1000u64.private,\n  _nonce: 123group.public\n}'],
    })
    const mockWallet = {
      account: { type: 'local', address: 'aleo1abc', sign: vi.fn() },
      writeContract: vi.fn(),
      executeTransaction,
      simulateContract: vi.fn(),
    }

    const contract = getContract({
      program: 'token.aleo',
      client: mockWallet as any,
    })

    const result = await contract.execute.mint({ inputs: ['aleo1abc', '1000u64'] })

    expect(result.transactionId).toBe('at1abc')
    expect(result.transitions).toHaveLength(1)
    expect(result.transitions[0].transitionId).toBe('au1first')
    expect(result.transitions[0].program).toBe('token.aleo')
    expect(result.transitions[0].function).toBe('mint')
    expect(result.transitions[0].outputs).toHaveLength(1)
  })

  it('parses transition with dynamicId record output', async () => {
    const executeTransaction = vi.fn().mockResolvedValue({
      transactionId: 'at1dyn',
      transitions: [
        {
          transitionId: 'au1dyn',
          program: 'token.aleo',
          function: 'transfer',
          outputs: ['{\n  owner: aleo1abc.private,\n  amount: 500u64.private,\n  _nonce: 999group.public\n}'],
        },
      ],
      outputs: ['{\n  owner: aleo1abc.private,\n  amount: 500u64.private,\n  _nonce: 999group.public\n}'],
    })
    const mockWallet = {
      account: { type: 'local', address: 'aleo1abc', sign: vi.fn() },
      writeContract: vi.fn(),
      executeTransaction,
      simulateContract: vi.fn(),
    }

    const { parseAbi } = await import('../../src/utils/parseAbi.js')
    const abi = parseAbi({
      program: 'token.aleo',
      structs: [],
      records: [{ path: ['Token'], fields: [
        { name: 'owner', ty: { Primitive: 'Address' }, mode: 'Private' },
        { name: 'amount', ty: { Primitive: { UInt: 'U64' } }, mode: 'Private' },
      ] }],
      mappings: [],
      storage_variables: [],
      functions: [{
        name: 'transfer',
        is_final: false,
        inputs: [
          { name: 'token', ty: { RecordWithDynamicId: { path: ['Token'], program: 'token.aleo', dynamic_id: '123field' } }, mode: 'Private' },
        ],
        outputs: [
          { ty: { RecordWithDynamicId: { path: ['Token'], program: 'token.aleo', dynamic_id: '456field' } }, mode: 'Private' },
        ],
      }],
    })

    // Verify the ABI parsed the dynamicId
    expect(abi.functions[0]!.inputs[0]!.type).toHaveProperty('dynamicId', '123field')
    expect(abi.functions[0]!.outputs[0]!.type).toHaveProperty('dynamicId', '456field')

    const contract = getContract({ program: 'token.aleo', abi, client: mockWallet as any })
    const result = await contract.execute.transfer({ inputs: ['record1...'] })

    // Output should still be parsed as a RecordValue despite dynamicId
    expect(result.transitions).toHaveLength(1)
    expect(result.transitions[0].outputs).toHaveLength(1)
    const output = result.transitions[0].outputs[0] as RecordValue
    expect(output.owner).toBe('aleo1abc')
    expect(output.fields.amount?.value).toBe(500n)
  })

  it('handles cross-program transitions with loose parsing', async () => {
    const executeTransaction = vi.fn().mockResolvedValue({
      transactionId: 'at1cross',
      transitions: [
        {
          transitionId: 'au1inner',
          program: 'loyalty_token.aleo',
          function: 'spend_points',
          outputs: ['{\n  owner: aleo1abc.private,\n  points: 500u64.private,\n  _nonce: 456group.public\n}'],
        },
        {
          transitionId: 'au1outer',
          program: 'loyalty_rewards.aleo',
          function: 'redeem',
          outputs: ['{\n  owner: aleo1abc.private,\n  amount: 200u64.private,\n  _nonce: 789group.public\n}'],
        },
      ],
      outputs: [
        '{\n  owner: aleo1abc.private,\n  points: 500u64.private,\n  _nonce: 456group.public\n}',
        '{\n  owner: aleo1abc.private,\n  amount: 200u64.private,\n  _nonce: 789group.public\n}',
      ],
    })
    const mockWallet = {
      account: { type: 'local', address: 'aleo1abc', sign: vi.fn() },
      writeContract: vi.fn(),
      executeTransaction,
      simulateContract: vi.fn(),
    }

    const contract = getContract({
      program: 'loyalty_rewards.aleo',
      client: mockWallet as any,
    })

    const result = await contract.execute.redeem({ inputs: [] })

    expect(result.transitions).toHaveLength(2)
    // Inner transition from different program — loose parsed
    expect(result.transitions[0].program).toBe('loyalty_token.aleo')
    expect(result.transitions[0].outputs[0]).toBeDefined()
    // Outer transition from same program — loose parsed (no ABI provided)
    expect(result.transitions[1].program).toBe('loyalty_rewards.aleo')
    // Top-level outputs match the called function's transition
    expect(result.outputs).toHaveLength(1)
  })

  it('falls back to flat outputs when transitions not available', async () => {
    const executeTransaction = vi.fn().mockResolvedValue({
      transactionId: 'at1old',
      outputs: ['100u64'],
    })
    const mockWallet = {
      account: { type: 'local', address: 'aleo1abc', sign: vi.fn() },
      writeContract: vi.fn(),
      executeTransaction,
      simulateContract: vi.fn(),
    }

    const contract = getContract({
      program: 'token.aleo',
      client: mockWallet as any,
    })

    const result = await contract.execute.mint({ inputs: ['aleo1abc', '1000u64'] })

    expect(result.transactionId).toBe('at1old')
    expect(result.transitions).toHaveLength(0)
    expect(result.outputs).toEqual(['100u64'])
  })
})
