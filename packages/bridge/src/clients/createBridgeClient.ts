import { createClient, type ClientConfig, type Client } from '@veil/core'
import { bridgeActions, type BridgeActions } from './decorators/bridge.js'

export type BridgeClientConfig = Omit<ClientConfig, 'account' | 'key' | 'name' | 'proving'> & {
  key?: string | undefined
  name?: string | undefined
}

export type BridgeClient = Client & BridgeActions

export function createBridgeClient(config: BridgeClientConfig): BridgeClient {
  const { key = 'bridge', name = 'Bridge Client', ...rest } = config
  const client = createClient({ ...rest, key, name })
  return client.extend(bridgeActions) as BridgeClient
}
