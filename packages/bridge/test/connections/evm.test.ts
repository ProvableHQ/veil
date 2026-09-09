import { describe, expect, it, vi } from 'vitest'
import {
  evmConnection,
  evmCustom,
  evmHttp,
  evmLocalAccount,
  evmPrivateKey,
  evmProvider,
  materializeEvmConnection,
} from '../../src/connections/evm.js'

describe('EVM bridge connections', () => {
  it('constructs an inert tagged definition', () => {
    const request = vi.fn()

    const definition = evmConnection({ transport: evmCustom(request) })

    expect(definition.family).toBe('evm')
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects duplicate public and wallet sources', () => {
    const request = vi.fn()
    const publicClient = {} as never
    const walletClient = {} as never

    expect(() => evmConnection({ transport: evmCustom(request), publicClient })).toThrow(
      'EVM connection accepts either transport or publicClient, not both',
    )
    expect(() => evmConnection({ account: evmProvider({ request }), walletClient })).toThrow(
      'EVM connection accepts either account or walletClient, not both',
    )
  })

  it('rejects an empty definition and a local account without public access', () => {
    expect(() => evmConnection({})).toThrow('EVM connection requires a public or wallet capability')
    expect(() =>
      evmConnection({
        account: evmLocalAccount({ address: '0x0000000000000000000000000000000000000001' } as never),
      }),
    ).toThrow('Local EVM accounts require an EVM transport or public client')
  })

  it('uses a dedicated public request and the provider for wallet submission', async () => {
    const publicRequest = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return '0x1'
      if (method === 'eth_call') return '0x1234'
      throw new Error(`unexpected ${method}`)
    })
    const providerRequest = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return ['0x0000000000000000000000000000000000000001']
      if (method === 'eth_chainId') return '0x1'
      if (method === 'eth_sendTransaction') return `0x${'ab'.repeat(32)}`
      throw new Error(`unexpected ${method}`)
    })
    const definition = evmConnection({
      transport: evmCustom(publicRequest),
      account: evmProvider({ request: providerRequest }),
    })

    const connection = materializeEvmConnection(definition, fetch)
    expect(await connection.publicClient?.getChainId()).toBe(1)
    expect(await connection.walletClient?.getAddress()).toBe('0x0000000000000000000000000000000000000001')
    await connection.walletClient?.sendTransaction({
      chainId: 1,
      to: '0x0000000000000000000000000000000000000002',
      data: '0x',
    })

    expect(publicRequest).toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_chainId' }), undefined)
    expect(providerRequest).toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_sendTransaction' }))
  })

  it('signs a raw-key transaction locally and broadcasts raw bytes', async () => {
    const methods: string[] = []
    const hash = `0x${'ab'.repeat(32)}` as const
    const request = vi.fn(async ({ method }: { method: string }) => {
      methods.push(method)
      if (method === 'eth_chainId') return '0x1'
      if (method === 'eth_getTransactionCount') return '0x0'
      if (method === 'eth_estimateGas') return '0x5208'
      if (method === 'eth_gasPrice') return '0x3b9aca00'
      if (method === 'eth_getBlockByNumber') return {
        number: '0x1', hash: `0x${'01'.repeat(32)}`, parentHash: `0x${'02'.repeat(32)}`,
        nonce: '0x0000000000000000', sha3Uncles: `0x${'03'.repeat(32)}`, logsBloom: `0x${'00'.repeat(256)}`,
        transactionsRoot: `0x${'04'.repeat(32)}`, stateRoot: `0x${'05'.repeat(32)}`,
        receiptsRoot: `0x${'06'.repeat(32)}`, miner: '0x0000000000000000000000000000000000000000',
        difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', size: '0x1',
        gasLimit: '0x1c9c380', gasUsed: '0x0', timestamp: '0x1', transactions: [], uncles: [],
      }
      if (method === 'eth_sendRawTransaction') return hash
      throw new Error(`unexpected ${method}`)
    })
    const connection = materializeEvmConnection(evmConnection({
      transport: evmCustom(request),
      account: evmPrivateKey(`0x${'11'.repeat(32)}`),
    }), fetch)

    await expect(connection.walletClient?.sendTransaction({
      chainId: 1,
      to: '0x0000000000000000000000000000000000000002',
      data: '0x',
      value: 1n,
    })).resolves.toBe(hash)
    expect(methods).toContain('eth_sendRawTransaction')
    expect(methods).not.toContain('eth_sendTransaction')
  })

  it('validates a direct viem wallet chain and supplies its resolved account', async () => {
    const sendTransaction = vi.fn(async () => `0x${'ab'.repeat(32)}`)
    const walletClient = {
      account: undefined,
      getAddresses: async () => ['0x0000000000000000000000000000000000000001'],
      getChainId: async () => 1,
      sendTransaction,
    } as never
    const connection = materializeEvmConnection(evmConnection({
      transport: evmCustom(async () => '0x1'),
      walletClient,
    }), fetch)

    await connection.walletClient?.sendTransaction({
      chainId: 1,
      to: '0x0000000000000000000000000000000000000002',
      data: '0x',
    })
    expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({
      account: '0x0000000000000000000000000000000000000001',
    }))
    await expect(connection.walletClient?.sendTransaction({
      chainId: 2,
      to: '0x0000000000000000000000000000000000000002',
      data: '0x',
    })).rejects.toThrow(/expected 2/)
  })

  it('preserves a direct viem wallet local account so viem signs locally', async () => {
    const localAccount = { address: '0x0000000000000000000000000000000000000001' }
    const sendTransaction = vi.fn(async () => `0x${'ab'.repeat(32)}`)
    const walletClient = {
      account: localAccount,
      getChainId: async () => 1,
      sendTransaction,
    } as never
    const connection = materializeEvmConnection(evmConnection({
      transport: evmCustom(async () => '0x1'),
      walletClient,
    }), fetch)

    await connection.walletClient?.sendTransaction({
      chainId: 1,
      to: '0x0000000000000000000000000000000000000002',
      data: '0x',
    })
    expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ account: localAccount }))
  })

  it('uses the transport fetch override ahead of the client default', async () => {
    const transportFetch = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' })))
    const defaultFetch = vi.fn()
    const connection = materializeEvmConnection(evmConnection({
      transport: evmHttp('https://rpc.example', { fetch: transportFetch }),
    }), defaultFetch as never)

    await expect(connection.publicClient?.getChainId()).resolves.toBe(1)
    expect(transportFetch).toHaveBeenCalledOnce()
    expect(defaultFetch).not.toHaveBeenCalled()
  })

  it('derives public access from a provider-only connection', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return '0x1'
      throw new Error(`unexpected ${method}`)
    })
    const connection = materializeEvmConnection(evmConnection({ account: evmProvider({ request }) }), fetch)

    await expect(connection.publicClient?.getChainId()).resolves.toBe(1)
  })

  it('derives public access from a direct wallet-client connection', async () => {
    const walletClient = {
      account: undefined,
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_chainId') return '0x1'
        throw new Error(`unexpected ${method}`)
      },
      getAddresses: async () => ['0x0000000000000000000000000000000000000001'],
      getChainId: async () => 1,
      sendTransaction: async () => `0x${'ab'.repeat(32)}`,
    } as never

    const connection = materializeEvmConnection(evmConnection({ walletClient }), fetch)

    await expect(connection.publicClient.getChainId()).resolves.toBe(1)
  })

  it('keeps receipt reads on a dedicated public client', async () => {
    const hash = `0x${'ab'.repeat(32)}` as const
    const getTransactionReceipt = vi.fn(async () => ({ status: 'success', transactionHash: hash }))
    const providerRequest = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return ['0x0000000000000000000000000000000000000001']
      throw new Error(`unexpected ${method}`)
    })
    const connection = materializeEvmConnection(evmConnection({
      publicClient: { getTransactionReceipt } as never,
      account: evmProvider({ request: providerRequest }),
    }), fetch)

    await expect(connection.publicClient?.getTransactionReceipt(hash)).resolves.toMatchObject({ transactionHash: hash })
    expect(getTransactionReceipt).toHaveBeenCalledWith({ hash })
    expect(providerRequest).not.toHaveBeenCalled()
  })
})
