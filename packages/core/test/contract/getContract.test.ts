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
      imports: [],
      records: [],
      structs: [],
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
      imports: [],
      records: [],
      structs: [],
    }

    // getContract needs a wallet client for write — test the error path
    const contract = getContract({ program: 'token.aleo', abi, client })
    expect(() => contract.write.transfer({ inputs: [] })).toThrow('no wallet client provided')
  })

  it('throws when reading without public client', () => {
    const request = vi.fn()
    const mockWallet = {
      writeContract: vi.fn(),
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
      executeTransaction: vi.fn(),
      deployContract: vi.fn(),
      signMessage: vi.fn(),
      transfer: vi.fn(),
      decrypt: vi.fn(),
      requestRecords: vi.fn(),
    }

    const contract = getContract({ program: 'token.aleo', client: mockWallet as any })
    expect(() => contract.read.balances({ key: 'aleo1abc' })).toThrow('no public client provided')
  })
})
