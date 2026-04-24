import { describe, it, expect, vi } from 'vitest'
import { createPublicClient } from '../../src/clients/createPublicClient.js'
import { http } from '../../src/transports/http.js'
import { getCode } from '../../src/actions/public/getCode.js'
import { parseProgram } from '../../src/contract/parseProgram.js'
import { getContract } from '../../src/contract/getContract.js'

describe('integration: public client with http transport', () => {
  it('getBalance makes the correct HTTP call and parses response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve('5000000u64'),
      text: () => Promise.resolve('5000000u64'),
    })

    const transport = http('https://api.example.com/v2', {
      fetchFn: mockFetch,
      network: 'mainnet',
    })
    const client = createPublicClient({ transport })

    const balance = await client.getBalance({ address: 'aleo1abc123' })

    expect(balance).toBe(5000000n)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/v2/mainnet/program/credits.aleo/mapping/account/aleo1abc123',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getBlockNumber makes the correct HTTP call and returns bigint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(12345),
      text: () => Promise.resolve('12345'),
    })

    const transport = http('https://api.example.com/v2', { fetchFn: mockFetch })
    const client = createPublicClient({ transport })

    const height = await client.getBlockNumber()

    expect(height).toBe(12345n)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/v2/mainnet/block/height/latest',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('readContract maps to correct REST URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve('42u64'),
      text: () => Promise.resolve('42u64'),
    })

    const transport = http('https://api.example.com/v2', { fetchFn: mockFetch })
    const client = createPublicClient({ transport })

    const value = await client.readContract({
      programId: 'token.aleo',
      mapping: 'balances',
      key: 'aleo1addr',
    })

    expect(value).toBe('42u64')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/v2/mainnet/program/token.aleo/mapping/balances/aleo1addr',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getCode fetches program source', async () => {
    const programSource = `program token.aleo;

mapping balances:
  key as address.public;
  value as u64.public;

function transfer:
  input r0 as address.public;
  input r1 as u64.public;
  output r2 as u64.public;

finalize transfer:
  input r0 as address.public;
  input r1 as u64.public;`

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(programSource),
      text: () => Promise.resolve(programSource),
    })

    const transport = http('https://api.example.com/v2', { fetchFn: mockFetch })
    const client = createPublicClient({ transport })

    const source = await client.getCode({ programId: 'token.aleo' })
    expect(source).toBe(programSource)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/v2/mainnet/program/token.aleo',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('http transport returns error for non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
      json: () => Promise.resolve('Not Found'),
    })

    const transport = http('https://api.example.com/v2', { fetchFn: mockFetch })
    const client = createPublicClient({ transport })

    await expect(client.getBalance({ address: 'aleo1abc' })).rejects.toThrow('HTTP 404')
  })

  it('http transport with testnet network', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(999),
      text: () => Promise.resolve('999'),
    })

    const transport = http('https://api.example.com/v2', {
      fetchFn: mockFetch,
      network: 'testnet',
    })
    const client = createPublicClient({ transport })

    await client.getBlockNumber()

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/v2/testnet/block/height/latest',
      expect.anything(),
    )
  })
})

describe('integration: getCode -> parseProgram -> getContract -> read', () => {
  it('full flow from program source to contract.read.balances()', async () => {
    const programSource = `program token.aleo;

mapping balances:
  key as address.public;
  value as u64.public;

function transfer:
  input r0 as address.public;
  input r1 as u64.public;
  output r2 as u64.public;

finalize transfer:
  input r0 as address.public;
  input r1 as u64.public;`

    // Mock: first call returns program source, second returns mapping value
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(programSource),
        text: () => Promise.resolve(programSource),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve('1000000u64'),
        text: () => Promise.resolve('1000000u64'),
      })

    const transport = http('https://api.example.com/v2', { fetchFn: mockFetch })
    const client = createPublicClient({ transport })

    // Step 1: getCode
    const source = await client.getCode({ programId: 'token.aleo' })

    // Step 2: parseProgram
    const abi = parseProgram(source)
    expect(abi.id).toBe('token.aleo')
    expect(abi.mappings).toHaveLength(1)
    expect(abi.mappings[0]!.name).toBe('balances')
    expect(abi.functions).toHaveLength(1)
    expect(abi.functions[0]!.name).toBe('transfer')
    expect(abi.functions[0]!.hasFinalize).toBe(true)

    // Step 3: getContract with parsed ABI
    const contract = getContract({ program: 'token.aleo', abi, client })

    // Step 4: contract.read.balances()
    const value = await contract.read.balances({ key: 'aleo1owner' })
    expect(value).toBe('1000000u64')

    // Verify the mapping call went to the right URL
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://api.example.com/v2/mainnet/program/token.aleo/mapping/balances/aleo1owner',
      expect.anything(),
    )
  })

  it('contract.read rejects invalid mapping names with ABI', async () => {
    const abi = parseProgram(`program token.aleo;

mapping balances:
  key as address.public;
  value as u64.public;`)

    const mockFetch = vi.fn()
    const transport = http('https://api.example.com/v2', { fetchFn: mockFetch })
    const client = createPublicClient({ transport })

    const contract = getContract({ program: 'token.aleo', abi, client })

    expect(() => contract.read.nonexistent({ key: 'aleo1abc' })).toThrow(
      'Mapping "nonexistent" does not exist',
    )
  })

  it('contract.fetchAbi populates the abi', async () => {
    const programSource = `program token.aleo;

mapping balances:
  key as address.public;
  value as u64.public;`

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(programSource),
      text: () => Promise.resolve(programSource),
    })

    const transport = http('https://api.example.com/v2', { fetchFn: mockFetch })
    const client = createPublicClient({ transport })

    const contract = getContract({ program: 'token.aleo', client })
    expect(contract.abi).toBeUndefined()

    const abi = await contract.fetchAbi()
    expect(abi.id).toBe('token.aleo')
    expect(contract.abi).toBeDefined()
    expect(contract.abi!.mappings).toHaveLength(1)
  })
})
