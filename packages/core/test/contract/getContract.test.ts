import { describe, it, expect, vi } from 'vitest'
import { getContract } from '../../src/contract/getContract.js'
import { createPublicClient } from '../../src/clients/createPublicClient.js'
import { custom } from '../../src/transports/custom.js'
import type { Program } from '../../src/types/program.js'

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

    await contract.execute.mint({ inputs: ['aleo1abc', '100u64'], fee: 1000n })

    expect(executeTransaction).toHaveBeenCalledWith({
      program: 'token.aleo',
      function: 'mint',
      inputs: ['aleo1abc', '100u64'],
      fee: 1000n,
      programSource: 'program token.aleo;',
      imports: {},
    })
  })

  it('simulate validates function names against ABI', () => {
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
    expect(() => contract.simulate.nonexistent({ inputs: [] })).toThrow('Function "nonexistent" does not exist')
  })

  it('simulate and execute throw without wallet client', () => {
    const request = vi.fn()
    const client = createPublicClient({ transport: custom({ request }) })
    const contract = getContract({ program: 'token.aleo', client })

    expect(() => contract.simulate.mint({ inputs: [] })).toThrow('no wallet client provided')
    expect(() => contract.execute.mint({ inputs: [] })).toThrow('no wallet client provided')
  })
})
