import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { getRouteStatus } from '../../src/actions/getRouteStatus.js'
import { createBridgeCheckpoint } from '../../src/actions/createBridgeCheckpoint.js'
import { prepare } from '../../src/actions/prepare.js'
import {
  BRIDGE_CONTEXT_HEADER,
  baseWalletClient,
  bridgeContextHeader,
  createTransferId,
  isTransferId,
  withBridgeContext,
} from '../../src/actions/internal/clientContext.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { version } from '../../src/version.js'

describe('bridge client context', () => {
  function aleoClient() {
    const request = vi.fn(async () => null)
    return { family: 'aleo' as const, publicClient: { request, marker: 'base' } as never, request }
  }

  const ROUTE = 'hyperlane:aleo/eth->ethereum/eth'

  it('leads the header with the SDK name and version', () => {
    expect(bridgeContextHeader('quote')).toBe(`sdk=aleo-bridge-sdk/${version}; action=quote`)
  })

  it('adds the protocol, route, and transfer identifier when known', () => {
    expect(bridgeContextHeader('status', { protocol: 'hyperlane', routeId: ROUTE, transferId: '0123456789abcdef' }))
      .toBe(`sdk=aleo-bridge-sdk/${version}; action=status; protocol=hyperlane; route=${ROUTE}; transfer=0123456789abcdef`)
  })

  it('drops a transfer identifier without the minted shape', () => {
    expect(bridgeContextHeader('status', { transferId: 'abc\r\nX-Injected: 1' })).not.toContain('transfer=')
  })

  it('neutralizes separators and control characters in a route identifier', () => {
    const header = bridgeContextHeader('status', { routeId: 'a;b\r\nc d' })
    expect(header).toContain('route=a_b__c_d')
  })

  it('mints 16 lowercase hex characters', () => {
    const id = createTransferId()
    expect(isTransferId(id)).toBe(true)
    expect(createTransferId()).not.toBe(id)
  })

  it('attaches the header to Aleo requests and keeps the base client reachable', async () => {
    const aleo = aleoClient()
    const tagged = withBridgeContext({ aleo }, 'status', { routeId: ROUTE })
    const client = tagged.aleo as unknown as { publicClient: { request: (args: unknown) => Promise<unknown>; marker: string } }
    await client.publicClient.request({ method: 'getLatestHeight' })
    expect(aleo.request).toHaveBeenCalledWith({
      method: 'getLatestHeight',
      clientHeaders: { [BRIDGE_CONTEXT_HEADER]: bridgeContextHeader('status', { routeId: ROUTE }) },
    })
    expect(client.publicClient.marker).toBe('base')
  })

  it('keeps the enclosing action when one action runs inside another', async () => {
    const aleo = aleoClient()
    const outer = withBridgeContext({ aleo }, 'execute')
    const inner = withBridgeContext(outer, 'route-status')
    await (inner.aleo as unknown as { publicClient: { request: (args: unknown) => Promise<unknown> } })
      .publicClient.request({ method: 'getLatestHeight' })
    expect(aleo.request).toHaveBeenCalledWith(expect.objectContaining({
      clientHeaders: { [BRIDGE_CONTEXT_HEADER]: bridgeContextHeader('execute') },
    }))
  })

  it('adds the header to wallet executions and keeps the wallet account reachable', async () => {
    const executeTransaction = vi.fn(async () => 'at1tagged')
    const aleo = { ...aleoClient(), walletClient: { executeTransaction, account: { type: 'local', address: 'aleo1signer' } } as never }
    const tagged = withBridgeContext({ aleo }, 'execute', { routeId: ROUTE })
    const wallet = (tagged.aleo as unknown as { walletClient: { executeTransaction: (params: unknown) => Promise<string>; account: { address: string } } }).walletClient
    await wallet.executeTransaction({ program: 'token.aleo', function: 'mint', inputs: [] })
    expect(executeTransaction).toHaveBeenCalledWith({
      program: 'token.aleo', function: 'mint', inputs: [],
      clientHeaders: { [BRIDGE_CONTEXT_HEADER]: bridgeContextHeader('execute', { routeId: ROUTE }) },
    })
    expect(wallet.account.address).toBe('aleo1signer')
    const nested = withBridgeContext(tagged, 'status').aleo as unknown as { walletClient: never }
    expect(baseWalletClient(nested.walletClient)).toBe((aleo as { walletClient: unknown }).walletClient)
  })

  it('leaves a wallet without a local account untouched', () => {
    const walletClient = { executeTransaction: vi.fn(), account: { type: 'rpc', address: 'aleo1signer' } }
    const aleo = { ...aleoClient(), walletClient: walletClient as never }
    const tagged = withBridgeContext({ aleo }, 'execute').aleo as unknown as { walletClient: unknown }
    expect(tagged.walletClient).toBe(walletClient)
  })

  it('passes an Aleo entry without a public client through unchanged', () => {
    const aleo = { family: 'aleo' as const, publicClient: undefined as never }
    expect(withBridgeContext({ aleo }, 'quote').aleo).toBe(aleo)
  })

  it('passes EVM clients through unchanged', () => {
    const ethereum = { family: 'evm' as const, publicClient: {} as never }
    expect(withBridgeContext({ ethereum }, 'quote').ethereum).toBe(ethereum)
  })

  it('tags the pause reads of getRouteStatus with the route', async () => {
    const aleo = aleoClient()
    await getRouteStatus(DEFAULT_BRIDGE_REGISTRY, { aleo }, { routeId: ROUTE })
    expect(aleo.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'getMappingValue',
      clientHeaders: {
        [BRIDGE_CONTEXT_HEADER]: bridgeContextHeader('route-status', { protocol: 'hyperlane', routeId: ROUTE }),
      },
    }))
  })

  it('carries the transfer identifier into a checkpoint', () => {
    const route = DEFAULT_BRIDGE_REGISTRY.routes.find((entry) => entry.id === ROUTE)!
    const assets = DEFAULT_BRIDGE_REGISTRY.assets
    const source = assets.find((asset) => asset.id === route.sourceAssetId)!
    const destination = assets.find((asset) => asset.id === route.destinationAssetId)!
    const plan = {
      ...prepare(DEFAULT_BRIDGE_REGISTRY, {
        source: { chain: source.chainId, asset: source.key },
        destination: { chain: destination.chainId, asset: destination.key },
        amount: '0.01',
        recipient: '0x1111111111111111111111111111111111111111',
      }),
      transferId: '0123456789abcdef',
    }
    const checkpoint = createBridgeCheckpoint(plan, {
      id: 'at1source', protocol: plan.protocol, status: 'SOURCE_CONFIRMING', sourceTxId: 'at1source',
      protocolState: { routeId: plan.route.id },
    })
    expect(checkpoint.transferId).toBe('0123456789abcdef')
  })

  it('version constant matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(version).toBe(pkg.version)
  })
})
