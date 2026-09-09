export type { AleoConnectionDefinition } from './aleo.js'
export type { EvmConnectionDefinition } from './evm.js'
export type { SolanaConnectionDefinition } from './solana.js'

import { materializeAleoConnection, type AleoConnectionDefinition } from './aleo.js'
import { materializeEvmConnection, type EvmConnectionDefinition } from './evm.js'
import { materializeSolanaConnection, type SolanaConnectionDefinition } from './solana.js'
import type { BridgeConnections } from './resolve.js'
import type { SolanaRpcHttpTransport } from '../types/solana.js'

/** Represents every inert bridge connection definition. */
export type BridgeConnectionDefinition = EvmConnectionDefinition | SolanaConnectionDefinition | AleoConnectionDefinition

/** Materializes registry-keyed definitions without exposing them on the client. */
export function materializeBridgeConnections(
  definitions: Readonly<Record<string, BridgeConnectionDefinition>>,
  fetch: typeof globalThis.fetch,
): BridgeConnections {
  return Object.fromEntries(Object.entries(definitions).map(([chainId, definition]) => {
    if (definition.family === 'evm') return [chainId, materializeEvmConnection(definition, fetch)]
    if (definition.family === 'solana') return [chainId, materializeSolanaConnection(definition, fetch as SolanaRpcHttpTransport)]
    return [chainId, materializeAleoConnection(definition)]
  }))
}
