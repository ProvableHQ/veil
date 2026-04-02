import { describe, it, expect, vi } from 'vitest'
import { createWalletClient } from '../../src/clients/createWalletClient.js'
import { custom } from '../../src/transports/custom.js'

describe('integration: wallet client with mock signer', () => {
  function createMockWalletClient() {
    const request = vi.fn()
    const account = {
      type: 'rpc' as const,
      address: 'aleo1sender',
      sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      signMessage: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }
    const transport = custom({ request })
    const client = createWalletClient({ account, transport })
    return { client, request, account }
  }

  it('writeContract calls transport with correct parameters', async () => {
    const { client, request } = createMockWalletClient()
    request.mockResolvedValue('at1txid_write')

    const txId = await client.writeContract({
      program: 'token.aleo',
      function: 'transfer',
      inputs: ['aleo1recipient', '100u64'],
      fee: 5000n,
    })

    expect(txId).toBe('at1txid_write')
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: {
        programName: 'token.aleo',
        functionName: 'transfer',
        inputs: ['aleo1recipient', '100u64'],
        fee: 5000n,
        privateFee: undefined,
      },
    })
  })

  it('transfer builds the right credits.aleo call for public transfer', async () => {
    const { client, request } = createMockWalletClient()
    request.mockResolvedValue('at1txid_transfer')

    const txId = await client.transfer({
      to: 'aleo1recipient',
      amount: 1000000n,
    })

    expect(txId).toBe('at1txid_transfer')
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: {
        programName: 'credits.aleo',
        functionName: 'transfer_public',
        inputs: ['aleo1recipient', '1000000u64'],
        fee: 0n,
        privateFee: undefined,
      },
    })
  })

  it('transfer builds the right credits.aleo call for private transfer', async () => {
    const { client, request } = createMockWalletClient()
    request.mockResolvedValue('at1txid_private')

    const txId = await client.transfer({
      to: 'aleo1recipient',
      amount: 500000n,
      privateFee: true,
    })

    expect(txId).toBe('at1txid_private')
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: {
        programName: 'credits.aleo',
        functionName: 'transfer_private',
        inputs: ['aleo1recipient', '500000u64'],
        fee: 0n,
        privateFee: true,
      },
    })
  })

  it('deployContract calls transport correctly', async () => {
    const { client, request } = createMockWalletClient()
    request.mockResolvedValue('at1deploy123')

    const txId = await client.deployContract({
      program: 'my_program.aleo',
      fee: 10000n,
    })

    expect(txId).toBe('at1deploy123')
    expect(request).toHaveBeenCalledWith({
      method: 'deployProgram',
      params: {
        program: 'my_program.aleo',
        fee: 10000n,
      },
    })
  })

  it('signMessage delegates to account.signMessage', async () => {
    const { client, account } = createMockWalletClient()

    const message = new Uint8Array([72, 101, 108, 108, 111])
    const sig = await client.signMessage({ message })

    expect(sig).toEqual(new Uint8Array([1, 2, 3]))
    expect(account.signMessage).toHaveBeenCalledWith(message)
  })

  it('sendTransaction delegates to transport', async () => {
    const { client, request } = createMockWalletClient()
    request.mockResolvedValue('at1sent_tx')

    const txId = await client.sendTransaction({
      transaction: '{"type":"execute","id":"at1..."}',
    })

    expect(txId).toBe('at1sent_tx')
    expect(request).toHaveBeenCalledWith({
      method: 'sendTransaction',
      params: { transaction: '{"type":"execute","id":"at1..."}' },
    })
  })

  it('writeContract with proving config uses buildTransaction', async () => {
    const request = vi.fn().mockResolvedValue('at1broadcast_tx')
    const mockBuildTransaction = vi.fn().mockResolvedValue({
      type: 'execute',
      id: 'at1built_tx',
    })
    const account = {
      type: 'local' as const,
      source: 'privateKey',
      address: 'aleo1sender',
      privateKey: 'APrivateKey1...',
      viewKey: 'AViewKey1...',
      sign: vi.fn(),
      signMessage: vi.fn(),
    }
    const transport = custom({ request })
    const client = createWalletClient({
      account,
      transport,
      proving: {
        mode: 'delegated',
        buildTransaction: mockBuildTransaction,
      },
    })

    await client.writeContract({
      program: 'token.aleo',
      function: 'mint',
      inputs: ['aleo1recipient', '1000u64'],
      fee: 5000n,
    })

    expect(mockBuildTransaction).toHaveBeenCalledWith({
      programName: 'token.aleo',
      functionName: 'mint',
      inputs: ['aleo1recipient', '1000u64'],
      fee: 5000n,
      privateFee: undefined,
    })
    expect(request).toHaveBeenCalledWith({
      method: 'sendTransaction',
      params: { transaction: JSON.stringify({ type: 'execute', id: 'at1built_tx' }) },
    })
  })
})
