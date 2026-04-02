import { describe, it, expect, vi } from 'vitest'
import { fromWalletAdapter } from '@aleo-viem/wallet-adapter'
import { createWalletClient, fallback, custom } from '@aleo-viem/core'
import type { AleoWalletAdapter } from '@aleo-viem/wallet-adapter'

function createMockAdapter(overrides?: Partial<AleoWalletAdapter>): AleoWalletAdapter {
  return {
    account: { address: 'aleo1walletowner12345678901234567890123456789012345678901234567890' },
    connected: true,
    signMessage: vi.fn().mockResolvedValue(new Uint8Array([10, 20, 30])),
    executeTransaction: vi.fn().mockResolvedValue({ transactionId: 'at1exec_tx' }),
    executeDeployment: vi.fn().mockResolvedValue({ transactionId: 'at1deploy_tx' }),
    transactionStatus: vi.fn().mockResolvedValue({ status: 'accepted' }),
    decrypt: vi.fn().mockResolvedValue('{ owner: aleo1..., data: {} }'),
    requestRecords: vi.fn().mockResolvedValue([{ owner: 'aleo1walletowner' }]),
    transitionViewKeys: vi.fn().mockResolvedValue(['tvk1abc']),
    ...overrides,
  }
}

describe('integration: wallet adapter full pattern', () => {
  it('fromWalletAdapter -> createWalletClient -> writeContract', async () => {
    const adapter = createMockAdapter()
    const { account, transport } = fromWalletAdapter(adapter)

    const client = createWalletClient({ account, transport })

    const txId = await client.writeContract({
      program: 'token.aleo',
      function: 'transfer',
      inputs: ['aleo1recipient', '100u64'],
      fee: 5000n,
    })

    expect(txId).toBe('at1exec_tx')
    expect(adapter.executeTransaction).toHaveBeenCalledWith({
      program: 'token.aleo',
      function: 'transfer',
      inputs: ['aleo1recipient', '100u64'],
      fee: 5000,
      privateFee: false,
    })
  })

  it('fromWalletAdapter -> createWalletClient -> transfer', async () => {
    const adapter = createMockAdapter()
    const { account, transport } = fromWalletAdapter(adapter)
    const client = createWalletClient({ account, transport })

    const txId = await client.transfer({
      to: 'aleo1recipient',
      amount: 1000000n,
    })

    expect(txId).toBe('at1exec_tx')
    expect(adapter.executeTransaction).toHaveBeenCalledWith({
      program: 'credits.aleo',
      function: 'transfer_public',
      inputs: ['aleo1recipient', '1000000u64'],
      fee: 0,
      privateFee: false,
    })
  })

  it('fromWalletAdapter -> createWalletClient -> deployContract', async () => {
    const adapter = createMockAdapter()
    const { account, transport } = fromWalletAdapter(adapter)
    const client = createWalletClient({ account, transport })

    const txId = await client.deployContract({
      program: 'my_program.aleo',
      fee: 10000n,
    })

    expect(txId).toBe('at1deploy_tx')
    expect(adapter.executeDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ program: 'my_program.aleo', fee: 10000 }),
    )
  })

  it('fromWalletAdapter -> createWalletClient -> signMessage', async () => {
    const adapter = createMockAdapter()
    const { account, transport } = fromWalletAdapter(adapter)
    const client = createWalletClient({ account, transport })

    const message = new Uint8Array([72, 101, 108, 108, 111])
    const sig = await client.signMessage({ message })

    expect(sig).toEqual(new Uint8Array([10, 20, 30]))
    expect(adapter.signMessage).toHaveBeenCalledWith(message)
  })

  it('fromWalletAdapter -> createWalletClient -> decrypt', async () => {
    const adapter = createMockAdapter()
    const { account, transport } = fromWalletAdapter(adapter)
    const client = createWalletClient({ account, transport })

    const plaintext = await client.decrypt({
      ciphertext: 'record1cipher...',
      tpk: 'tpk1...',
      programId: 'token.aleo',
      functionName: 'transfer',
    })

    expect(plaintext).toBe('{ owner: aleo1..., data: {} }')
    expect(adapter.decrypt).toHaveBeenCalledWith(
      'record1cipher...',
      'tpk1...',
      'token.aleo',
      'transfer',
    )
  })

  it('fromWalletAdapter -> createWalletClient -> requestRecords', async () => {
    const adapter = createMockAdapter()
    const { account, transport } = fromWalletAdapter(adapter)
    const client = createWalletClient({ account, transport })

    const records = await client.requestRecords({ program: 'token.aleo' })

    expect(records).toEqual([{ owner: 'aleo1walletowner' }])
    expect(adapter.requestRecords).toHaveBeenCalledWith('token.aleo', true)
  })

  it('wallet adapter transport with fallback for read operations', async () => {
    const adapter = createMockAdapter()
    const { account, transport: walletTransport } = fromWalletAdapter(adapter)

    // HTTP transport for reads
    const httpRequest = vi.fn().mockResolvedValue(42000)
    const httpTransport = custom({ request: httpRequest })

    const client = createWalletClient({
      account,
      transport: fallback([walletTransport, httpTransport]),
    })

    // Write operations go through the wallet adapter
    const txId = await client.writeContract({
      program: 'token.aleo',
      function: 'transfer',
      inputs: ['aleo1recipient', '100u64'],
      fee: 5000n,
    })
    expect(txId).toBe('at1exec_tx')
    expect(adapter.executeTransaction).toHaveBeenCalled()
  })
})
