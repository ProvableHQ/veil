import type { Client } from '@veil/core'

export type BridgeActions = Record<string, never>

export function bridgeActions(_client: Client): BridgeActions {
  return {}
}
