import { createBridgeClient, httpBridge, type BridgeClient } from '@veil/bridge'

/**
 * Bridge base URL. Defaults to Provable's wallet-services-api prod endpoint
 * (verified from ProvableHQ/private-web3-agents src/tools/bridge.ts).
 * Override via VITE_WSA_BASE_URL for staging / local dev.
 */
const WSA_BASE_URL = import.meta.env.VITE_WSA_BASE_URL ?? 'https://wallet.api.provable.com'

let cached: BridgeClient | null = null

export function getBridgeClient(): BridgeClient {
  if (!cached) {
    cached = createBridgeClient({
      transport: httpBridge(WSA_BASE_URL),
    })
  }
  return cached
}
