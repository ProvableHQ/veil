import { describe, it, expect, vi } from 'vitest'
import { rpcAccountFromAdapter, transportFromAdapter, fromWalletAdapter } from '../src/index.js'
import type { WalletAdapterLike } from '../src/index.js'

function createMockAdapter(overrides?: Partial<WalletAdapterLike>): WalletAdapterLike {
  return {
    publicKey: 'aleo1mockaddress',
    connected: true,
    signMessage: vi.fn().mockResolvedValue({ signature: new Uint8Array([1, 2, 3]) }),
    requestExecution: vi.fn().mockResolvedValue({ transactionId: 'at1txid123' }),
    requestDeploy: vi.fn().mockResolvedValue({ transactionId: 'at1deploy456' }),
    requestTransaction: vi.fn().mockResolvedValue({ transactionId: 'at1tx789' }),
    decrypt: vi.fn().mockResolvedValue('{ owner: aleo1..., data: {} }'),
    requestRecords: vi.fn().mockResolvedValue([{ owner: 'aleo1mock' }]),
    ...overrides,
  }
}

describe('rpcAccountFromAdapter', () => {
  it('creates an RpcAccount with correct address', () => {
    const adapter = createMockAdapter()
    const account = rpcAccountFromAdapter(adapter)

    expect(account.type).toBe('rpc')
    expect(account.address).toBe('aleo1mockaddress')
  })

  it('delegates signMessage to adapter', async () => {
    const adapter = createMockAdapter()
    const account = rpcAccountFromAdapter(adapter)

    const message = new Uint8Array([104, 101, 108, 108, 111])
    const sig = await account.signMessage(message)

    expect(adapter.signMessage).toHaveBeenCalledWith(message)
    expect(sig).toEqual(new Uint8Array([1, 2, 3]))
  })
})

describe('transportFromAdapter', () => {
  it('routes executeTransaction to adapter.requestExecution', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    const result = await transport.request({
      method: 'executeTransaction',
      params: {
        programName: 'token.aleo',
        functionName: 'transfer',
        inputs: ['aleo1recipient', '100u64'],
        fee: 1000,
        privateFee: false,
      },
    })

    expect(result).toBe('at1txid123')
    expect(adapter.requestExecution).toHaveBeenCalledWith({
      address: 'aleo1mockaddress',
      chainId: '1',
      transitions: [{
        program: 'token.aleo',
        functionName: 'transfer',
        inputs: ['aleo1recipient', '100u64'],
      }],
      fee: 1000,
      privateFee: false,
    })
  })

  it('routes deployProgram to adapter.requestDeploy', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    const result = await transport.request({
      method: 'deployProgram',
      params: { program: 'my_program.aleo', fee: 5000 },
    })

    expect(result).toBe('at1deploy456')
  })

  it('routes decrypt to adapter.decrypt', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    await transport.request({
      method: 'decrypt',
      params: { ciphertext: 'record1cipher...' },
    })

    expect(adapter.decrypt).toHaveBeenCalledWith('record1cipher...', undefined, undefined, undefined)
  })

  it('routes requestRecords to adapter.requestRecords', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    const records = await transport.request({
      method: 'requestRecords',
      params: { program: 'token.aleo' },
    })

    expect(adapter.requestRecords).toHaveBeenCalledWith('token.aleo')
    expect(records).toEqual([{ owner: 'aleo1mock' }])
  })

  it('throws on unknown methods', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    await expect(
      transport.request({ method: 'getBlock', params: { height: 1 } }),
    ).rejects.toThrow('does not handle method "getBlock"')
  })

  it('supports custom chainId', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter, { chainId: '3' })

    await transport.request({
      method: 'executeTransaction',
      params: { programName: 'test.aleo', functionName: 'run', inputs: [], fee: 0 },
    })

    expect(adapter.requestExecution).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: '3' }),
    )
  })
})

describe('fromWalletAdapter', () => {
  it('returns both account and transport', () => {
    const adapter = createMockAdapter()
    const { account, transport } = fromWalletAdapter(adapter)

    expect(account.type).toBe('rpc')
    expect(account.address).toBe('aleo1mockaddress')
    expect(transport.config.key).toBe('walletAdapter')
  })
})
