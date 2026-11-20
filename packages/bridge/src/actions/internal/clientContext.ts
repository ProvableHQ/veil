import type { Client } from '@provablehq/veil-core'
import type { BridgeChainClients } from '../../connections/resolve.js'
import type { AleoWalletClient } from '../../types/aleo.js'
import type { BridgePlan } from '../../types/protocol.js'
import { version } from '../../version.js'

export const BRIDGE_CONTEXT_HEADER = 'X-Aleo-Bridge'

export type BridgeAction = 'quote' | 'execute' | 'status' | 'wait' | 'complete' | 'resume' | 'recover' | 'route-status'

const TRANSFER_ID = /^[0-9a-f]{16}$/
const BASE_WALLET = Symbol('aleo-bridge.baseWallet')

export function baseWalletClient(wallet: AleoWalletClient): AleoWalletClient {
  return (wallet as { [BASE_WALLET]?: AleoWalletClient })[BASE_WALLET] ?? wallet
}

export function isTransferId(value: unknown): value is string {
  return typeof value === 'string' && TRANSFER_ID.test(value)
}

export function createTransferId(): string | undefined {
  const source = globalThis.crypto
  if (!source?.getRandomValues) return undefined
  const bytes = source.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function token(value: string): string {
  return value.replace(/[^\x21-\x7e]|;/g, '_')
}

export type BridgeContextSubject = {
  protocol?: string | undefined
  routeId?: string | undefined
  transferId?: string | undefined
}

export function planSubject(plan: BridgePlan): BridgeContextSubject {
  return { protocol: plan.protocol, routeId: plan.route.id, transferId: plan.transferId }
}

export function bridgeContextHeader(action: BridgeAction, subject: BridgeContextSubject = {}): string {
  return [
    `sdk=aleo-bridge-sdk/${version}`,
    `action=${action}`,
    ...(subject.protocol ? [`protocol=${token(subject.protocol)}`] : []),
    ...(subject.routeId ? [`route=${token(subject.routeId)}`] : []),
    ...(isTransferId(subject.transferId) ? [`transfer=${subject.transferId}`] : []),
  ].join('; ')
}

export function withBridgeContext(
  clients: BridgeChainClients,
  action: BridgeAction,
  subject?: BridgeContextSubject,
): BridgeChainClients {
  const headers = { [BRIDGE_CONTEXT_HEADER]: bridgeContextHeader(action, subject) }
  return Object.fromEntries(Object.entries(clients).map(([chainId, client]) => {
    if (client.family !== 'aleo' || !client.publicClient) return [chainId, client]
    const base = client.publicClient
    const publicClient: Client = Object.assign(Object.create(base), {
      request: (args: Parameters<Client['request']>[0]) => base.request({
        ...args,
        clientHeaders: { ...args.clientHeaders, ...headers },
      }),
    })
    const wallet = client.walletClient
    const walletClient = wallet?.account?.type === 'local' && Object.assign(Object.create(wallet), {
      [BASE_WALLET]: baseWalletClient(wallet),
      executeTransaction: (params: Parameters<typeof wallet.executeTransaction>[0]) => wallet.executeTransaction({
        ...params,
        clientHeaders: { ...params.clientHeaders, ...headers },
      }),
    })
    return [chainId, { ...client, publicClient, ...(walletClient ? { walletClient } : {}) }]
  }))
}
