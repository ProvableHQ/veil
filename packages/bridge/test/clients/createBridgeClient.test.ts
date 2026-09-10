import { describe, expect, it } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { createEvmClient, evmCustom } from '../../src/connections/evm.js'
import { createSolanaClient, solanaCustom, solanaWallet } from '../../src/connections/solana.js'
import { hyperlane, xreserve } from '../../src/index.js'

describe('createBridgeClient', () => {
  it('defaults discovery to mainnet without exposing a fake base client', () => {
    const client = createBridgeClient()
    expect(client.environment).toBe('mainnet')
    expect(client.getAssets().every((asset) => !asset.chainId.includes('testnet') && asset.chainId !== 'sepolia')).toBe(true)
    expect('extend' in client).toBe(false)
  })

  it('selects testnet without hiding explicit environment queries', () => {
    const client = createBridgeClient({ environment: 'testnet' })
    expect(client.getRoutes().every((route) => route.environment === 'testnet')).toBe(true)
    expect(client.getRoutes({ environment: 'mainnet' }).length).toBeGreaterThan(0)
  })

  it('binds transfer planning to the configured registry', () => {
    const client = createBridgeClient()
    const plan = client.prepare({
      source: { chain: 'aleo', asset: 'usdcx' },
      destination: { chain: 'ethereum', asset: 'usdc' },
      amount: '1',
      recipient: '0x0000000000000000000000000000000000000001',
    })
    expect(plan.registryVersion).toBe(client.registry.version)
  })

  it('does not expose pure call builders as client actions', () => {
    const client = createBridgeClient()

    expect('buildAleoHyperlaneTransferRemoteCall' in client).toBe(false)
    expect('buildXReserveBurnCall' in client).toBe(false)
  })

  it('exposes protocol-neutral transfer quote and execution actions', () => {
    const client = createBridgeClient()

    expect(client.prepare).toBeTypeOf('function')
    expect(client.quote).toBeTypeOf('function')
    expect(client.execute).toBeTypeOf('function')
    expect(client.getStatus).toBeTypeOf('function')
    expect(client.wait).toBeTypeOf('function')
    expect(client.waitForStatus).toBeTypeOf('function')
    expect(client.resume).toBeTypeOf('function')
    expect(client.complete).toBeTypeOf('function')
    expect('prepareTransfer' in client).toBe(false)
    expect('quoteTransfer' in client).toBe(false)
    expect('executeTransfer' in client).toBe(false)
    expect('quoteEvmHyperlaneTransfer' in client).toBe(false)
    expect('executeEvmHyperlaneTransfer' in client).toBe(false)
    expect('quoteEvmXReserveTransfer' in client).toBe(false)
    expect('executeEvmXReserveTransfer' in client).toBe(false)
    expect('quoteSolanaHyperlaneTransfer' in client).toBe(false)
    expect('executeSolanaHyperlaneTransfer' in client).toBe(false)
    expect('quoteAleoHyperlaneGasPayment' in client).toBe(false)
    expect('executeAleoHyperlaneTransferRemote' in client).toBe(false)
    expect('executeXReserveBurn' in client).toBe(false)
  })

  it('exports namespaced bare protocol helpers without decorating the client', () => {
    expect(hyperlane.evm.quote).toBeTypeOf('function')
    expect(hyperlane.evm.execute).toBeTypeOf('function')
    expect(hyperlane.solana.quote).toBeTypeOf('function')
    expect(hyperlane.aleo.execute).toBeTypeOf('function')
    expect(xreserve.evmToAleo.getAttestation).toBeTypeOf('function')
    expect(xreserve.evmToAleo.complete).toBeTypeOf('function')
    expect(xreserve.aleoToEvm.execute).toBeTypeOf('function')
    expect('hyperlane' in createBridgeClient()).toBe(false)
    expect('xreserve' in createBridgeClient()).toBe(false)
  })

  it('uses the default registry for a bare protocol helper', async () => {
    const messageHash = `0x${'11'.repeat(32)}` as const
    await expect(xreserve.evmToAleo.getAttestation(
      async () => ({ ok: false, status: 404, json: async () => ({}) }),
      { routeId: 'xreserve:sepolia/usdc->aleo-testnet/usdcx', messageHash },
    )).resolves.toEqual({ status: 'pending', messageHash })
  })

  it('requires a chain-specific EVM client for live Hyperlane actions', async () => {
    const client = createBridgeClient()
    const plan = client.prepare({
      source: { chain: 'ethereum', asset: 'eth' },
      destination: { chain: 'aleo', asset: 'eth' },
      amount: '1',
      recipient: `aleo1${'a'.repeat(58)}`,
    })
    await expect(client.quote({ plan })).rejects.toThrow(/No client is configured for chain "ethereum"/)
  })

  it('dispatches xReserve quotes to the wallet-capable EVM implementation', async () => {
    const client = createBridgeClient({
      clients: { ethereum: createEvmClient({ transport: evmCustom(async () => '0x1') }) },
    })
    const plan = client.prepare({
      source: { chain: 'ethereum', asset: 'usdc' },
      destination: { chain: 'aleo', asset: 'usdcx' },
      amount: '1',
      recipient: 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n',
    })

    await expect(client.quote({ plan })).rejects.toThrow(/EVM wallet client is required to quote xReserve transfer/)
  })

  it('returns the prepared estimate when an Aleo xReserve burn has no live quote', async () => {
    const client = createBridgeClient()
    const plan = client.prepare({
      source: { chain: 'aleo', asset: 'usdcx' },
      destination: { chain: 'ethereum', asset: 'usdc' },
      amount: '1',
      recipient: '0x0000000000000000000000000000000000000001',
    })

    await expect(client.quote({ plan })).resolves.toEqual({
      kind: 'aleo-xreserve',
      routeId: plan.route.id,
      protocol: 'xreserve',
      amountIn: '1',
      fees: [],
      status: 'not-queried',
    })
  })

  it('rejects a stale prepared plan before protocol dispatch', async () => {
    const client = createBridgeClient()
    const plan = client.prepare({
      source: { chain: 'aleo', asset: 'usdcx' },
      destination: { chain: 'ethereum', asset: 'usdc' },
      amount: '1',
      recipient: '0x0000000000000000000000000000000000000001',
    })

    await expect(client.quote({
      plan: { ...plan, registryVersion: 'stale-registry' },
    })).rejects.toThrow(/uses registry stale-registry/)
  })

  it.each([
    ['hyperlane:ethereum/eth->aleo/eth', { chain: 'ethereum', asset: 'eth' }, { chain: 'aleo', asset: 'eth' }, `aleo1${'a'.repeat(58)}`, 'ethereum', 'EVM'],
    ['hyperlane:aleo/eth->ethereum/eth', { chain: 'aleo', asset: 'eth' }, { chain: 'ethereum', asset: 'eth' }, '0x0000000000000000000000000000000000000001', 'aleo', 'Aleo'],
    ['xreserve:aleo/usdcx->ethereum/usdc', { chain: 'aleo', asset: 'usdcx' }, { chain: 'ethereum', asset: 'usdc' }, '0x0000000000000000000000000000000000000001', 'aleo', 'Aleo'],
  ])('selects the %s source client for generic execution', async (_routeId, source, destination, recipient, chainId, family) => {
    const client = createBridgeClient()
    const plan = client.prepare({ source, destination, amount: '1', recipient })

    await expect(client.execute({ plan })).rejects.toThrow(
      new RegExp(`No client is configured for chain "${chainId}"|${family} wallet client is required`),
    )
  })

  it('binds the injected Circle attestation transport', async () => {
    const messageHash = `0x${'11'.repeat(32)}` as const
    const client = createBridgeClient({
      environment: 'testnet',
      fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response,
    })
    const plan = client.prepare({
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '1',
      recipient: 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n',
    })
    const receipt = {
      id: messageHash,
      protocol: 'xreserve' as const,
      status: 'ATTESTATION_PENDING' as const,
      protocolState: { routeId: plan.route.id, messageHash },
    }
    await expect(client.getStatus({ plan, receipt })).resolves.toBe(receipt)
  })

  it('accepts a registry-keyed Solana client', () => {
    const bridge = createBridgeClient({
      environment: 'mainnet',
      clients: {
        solana: createSolanaClient({
          transport: solanaCustom(async () => undefined),
          account: solanaWallet({
            wallet: { features: { 'solana:signAndSendTransaction': { signAndSendTransaction: async () => [] } } },
            account: { address: '11111111111111111111111111111111', publicKey: new Uint8Array(32) },
            chain: 'solana:mainnet',
          }),
        }),
      },
    })
    expect(bridge.environment).toBe('mainnet')
  })

  it('requires a Solana wallet capability for live execution', async () => {
    const client = createBridgeClient({ clients: { solana: createSolanaClient({ transport: solanaCustom(async () => undefined) }) } })
    const plan = client.prepare({
      source: { chain: 'solana', asset: 'sol' },
      destination: { chain: 'aleo', asset: 'sol' },
      amount: '1',
      recipient: `aleo1${'a'.repeat(58)}`,
    })
    await expect(client.execute({ plan })).rejects.toThrow(/Solana wallet client is required/)
  })

  it('selects clients from the source chain rather than a family default', async () => {
    const client = createBridgeClient({
      clients: { sepolia: createEvmClient({ transport: evmCustom(async () => '0x1') }) },
    })
    const plan = client.prepare({
      source: { chain: 'ethereum', asset: 'eth' },
      destination: { chain: 'aleo', asset: 'eth' },
      amount: '1',
      recipient: `aleo1${'a'.repeat(58)}`,
    })
    await expect(client.quote({ plan })).rejects.toThrow(/No client is configured for chain "ethereum"/)
  })
})
