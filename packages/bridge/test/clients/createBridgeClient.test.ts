import { describe, expect, it } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { createEvmClient, evmCustom } from '../../src/connections/evm.js'
import { createSolanaClient, solanaCustom, solanaWallet } from '../../src/connections/solana.js'

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
    const plan = client.prepareTransfer({
      routeId: 'xreserve:aleo/usdcx->ethereum/usdc',
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

  it('requires a chain-specific EVM client for live Hyperlane actions', async () => {
    const client = createBridgeClient()
    const plan = client.prepareTransfer({
      routeId: 'hyperlane:ethereum/eth->aleo/eth',
      amount: '1',
      recipient: `aleo1${'a'.repeat(58)}`,
    })
    await expect(client.quoteEvmHyperlaneTransfer({
      plan,
      recipientBytes32: '0x20e3629764d5338f74bee96675801b1fb29d1fc68b177668f9175708bef84311',
    })).rejects.toThrow(/No client is configured for chain "ethereum"/)
  })

  it('binds the injected Circle attestation transport', async () => {
    const messageHash = `0x${'11'.repeat(32)}` as const
    const client = createBridgeClient({
      environment: 'testnet',
      fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response,
    })
    await expect(client.getXReserveAttestation({
      routeId: 'xreserve:sepolia/usdc->aleo-testnet/usdcx',
      messageHash,
    })).resolves.toEqual({ status: 'pending', messageHash })
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
    const plan = client.prepareTransfer({
      routeId: 'hyperlane:solana/sol->aleo/sol',
      amount: '1',
      recipient: `aleo1${'a'.repeat(58)}`,
    })
    await expect(client.executeSolanaHyperlaneTransfer({ plan })).rejects.toThrow(/Solana wallet client is required/)
  })

  it('selects clients from the source chain rather than a family default', async () => {
    const client = createBridgeClient({
      clients: { sepolia: createEvmClient({ transport: evmCustom(async () => '0x1') }) },
    })
    const plan = client.prepareTransfer({
      routeId: 'hyperlane:ethereum/eth->aleo/eth',
      amount: '1',
      recipient: `aleo1${'a'.repeat(58)}`,
    })
    await expect(client.quoteEvmHyperlaneTransfer({
      plan,
      recipientBytes32: `0x${'11'.repeat(32)}`,
    })).rejects.toThrow(/No client is configured for chain "ethereum"/)
  })
})
