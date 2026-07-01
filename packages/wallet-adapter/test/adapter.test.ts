import { describe, it, expect, vi } from 'vitest'
import {
  rpcAccountFromAdapter,
  transportFromAdapter,
  fromWalletAdapter,
  type AleoWalletAdapter,
} from '../src/index.js'

/**
 * Creates a mock that matches the real BaseAleoWalletAdapter interface
 * from @provablehq/aleo-wallet-adaptor-core
 */
function createMockAdapter(overrides?: Partial<AleoWalletAdapter>): AleoWalletAdapter {
  return {
    account: { address: 'aleo1mockaddress123456789012345678901234567890123456789012345678' },
    connected: true,
    network: 'mainnet',
    signMessage: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    executeTransaction: vi.fn().mockResolvedValue({ transactionId: 'at1txid123' }),
    executeDeployment: vi.fn().mockResolvedValue({ transactionId: 'at1deploy456' }),
    transactionStatus: vi.fn().mockResolvedValue({ status: 'accepted', transactionId: 'at1final' }),
    decrypt: vi.fn().mockResolvedValue('{ owner: aleo1..., data: {} }'),
    requestRecords: vi.fn().mockResolvedValue([{ owner: 'aleo1mock' }]),
    transitionViewKeys: vi.fn().mockResolvedValue(['tvk1abc', 'tvk1def']),
    switchNetwork: vi.fn().mockResolvedValue(undefined),
    requestTransactionHistory: vi.fn().mockResolvedValue({ transactions: [] }),
    algorithmsSupported: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

describe('rpcAccountFromAdapter', () => {
  it('creates an RpcAccount with correct address', () => {
    const adapter = createMockAdapter()
    const account = rpcAccountFromAdapter(adapter)

    expect(account.type).toBe('rpc')
    expect(account.address).toBe('aleo1mockaddress123456789012345678901234567890123456789012345678')
  })

  it('delegates sign to adapter.signMessage', async () => {
    const adapter = createMockAdapter()
    const account = rpcAccountFromAdapter(adapter)

    const message = new Uint8Array([104, 101, 108, 108, 111])
    const sig = await account.sign(message)

    expect(adapter.signMessage).toHaveBeenCalledWith(message)
    expect(sig).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('delegates signMessage to adapter.signMessage', async () => {
    const adapter = createMockAdapter()
    const account = rpcAccountFromAdapter(adapter)

    const message = new Uint8Array([1, 2])
    await account.signMessage(message)

    expect(adapter.signMessage).toHaveBeenCalledWith(message)
  })

  it('throws when adapter is not connected', () => {
    const adapter = createMockAdapter({ account: undefined })

    expect(() => rpcAccountFromAdapter(adapter)).toThrow('not connected')
  })
})

describe('transportFromAdapter', () => {
  it('routes executeTransaction to adapter.executeTransaction', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    const result = await transport.request({
      method: 'executeTransaction',
      params: {
        programName: 'token.aleo',
        functionName: 'transfer',
        inputs: ['aleo1recipient', '100u64'],
        privateFee: false,
      },
    })

    expect(result).toBe('at1txid123')
    expect(adapter.executeTransaction).toHaveBeenCalledWith({
      program: 'token.aleo',
      function: 'transfer',
      inputs: ['aleo1recipient', '100u64'],
      privateFee: false,
    })
  })

  it('forwards InputRequest inputs to the adapter unchanged', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)
    const recReq = { type: 'record', program: 'amm_v3.aleo', recordname: 'credits', uid: 'u1' }

    await transport.request({
      method: 'executeTransaction',
      params: {
        programName: 'amm_v3.aleo',
        functionName: 'swap_private',
        inputs: [recReq, { type: 'address' }, '100u64'],
      },
    })

    const opts = (adapter.executeTransaction as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(opts.inputs[0]).toEqual(recReq)
    expect(opts.inputs[1]).toEqual({ type: 'address' })
    expect(opts.inputs[2]).toBe('100u64')
  })

  it('routes algorithmsSupported to adapter.algorithmsSupported', async () => {
    const adapter = createMockAdapter({
      algorithmsSupported: vi.fn().mockResolvedValue(['program-scoped-blinding-factor']),
    })
    const transport = transportFromAdapter(adapter)

    const result = await transport.request({ method: 'algorithmsSupported', params: {} })

    expect(result).toEqual(['program-scoped-blinding-factor'])
    expect(adapter.algorithmsSupported).toHaveBeenCalled()
  })

  it('routes deployProgram to adapter.executeDeployment', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    const result = await transport.request({
      method: 'deployProgram',
      params: { program: 'my_program.aleo' },
    })

    expect(result).toBe('at1deploy456')
    expect(adapter.executeDeployment).toHaveBeenCalledWith({
      program: 'my_program.aleo',
      address: 'aleo1mockaddress123456789012345678901234567890123456789012345678',
      priorityFee: 0,
      privateFee: false,
    })
  })

  it('routes signMessage to adapter.signMessage', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    const message = new Uint8Array([1, 2, 3])
    const result = await transport.request({
      method: 'signMessage',
      params: { message },
    })

    expect(adapter.signMessage).toHaveBeenCalledWith(message)
    expect(result).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('routes decrypt to adapter.decrypt with all params', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    await transport.request({
      method: 'decrypt',
      params: {
        cipherText: 'record1cipher...',
        tpk: 'tpk1...',
        programId: 'token.aleo',
        functionName: 'transfer',
      },
    })

    expect(adapter.decrypt).toHaveBeenCalledWith(
      'record1cipher...',
      'tpk1...',
      'token.aleo',
      'transfer',
      undefined,
    )
  })

  it('routes requestRecords to adapter.requestRecords', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    const records = await transport.request({
      method: 'requestRecords',
      params: { program: 'token.aleo' },
    })

    expect(adapter.requestRecords).toHaveBeenCalledWith('token.aleo', true, undefined)
    expect(records).toEqual([{ owner: 'aleo1mock' }])
  })

  it('routes transactionStatus to adapter.transactionStatus', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    const status = await transport.request({
      method: 'transactionStatus',
      params: { transactionId: 'at1tx123' },
    })

    expect(adapter.transactionStatus).toHaveBeenCalledWith('at1tx123')
    expect(status).toEqual({ status: 'accepted', transactionId: 'at1final' })
  })

  it('routes getTransitionViewKeys to adapter.transitionViewKeys', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    const keys = await transport.request({
      method: 'getTransitionViewKeys',
      params: { id: 'at1tx456' },
    })

    expect(adapter.transitionViewKeys).toHaveBeenCalledWith('at1tx456')
    expect(keys).toEqual(['tvk1abc', 'tvk1def'])
  })

  it('throws on unknown methods with helpful message', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    await expect(
      transport.request({ method: 'getBlock', params: { height: 1 } }),
    ).rejects.toThrow('does not handle method "getBlock"')
  })

  it('defaults privateFee to false', async () => {
    const adapter = createMockAdapter()
    const transport = transportFromAdapter(adapter)

    await transport.request({
      method: 'executeTransaction',
      params: {
        programName: 'test.aleo',
        functionName: 'run',
        inputs: [],
      },
    })

    expect(adapter.executeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ privateFee: false }),
    )
  })
})

describe('fromWalletAdapter', () => {
  it('returns both account and transport from a connected adapter', () => {
    const adapter = createMockAdapter()
    const { account, transport } = fromWalletAdapter(adapter)

    expect(account.type).toBe('rpc')
    expect(account.address).toBe('aleo1mockaddress123456789012345678901234567890123456789012345678')
    expect(transport.config.key).toBe('walletAdapter')
    expect(transport.config.name).toBe('Wallet Adapter Transport')
  })

  it('throws when adapter is not connected', () => {
    const adapter = createMockAdapter({ account: undefined })
    expect(() => fromWalletAdapter(adapter)).toThrow('not connected')
  })

  it('integrates with createWalletClient pattern', async () => {
    // This test demonstrates the full wiring:
    // fromWalletAdapter → createWalletClient → walletClient.writeContract
    const adapter = createMockAdapter()
    const { account, transport } = fromWalletAdapter(adapter)

    // Manually wire like createWalletClient does
    const result = await transport.request({
      method: 'executeTransaction',
      params: {
        programName: 'token.aleo',
        functionName: 'transfer',
        inputs: ['aleo1dest', '50u64'],
      },
    })

    expect(result).toBe('at1txid123')
    expect(account.address).toBe('aleo1mockaddress123456789012345678901234567890123456789012345678')
  })
})
