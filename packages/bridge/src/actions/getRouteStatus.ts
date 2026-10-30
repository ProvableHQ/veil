import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi } from 'viem'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeChainClient, BridgeChainClients } from '../connections/resolve.js'
import type { AleoMappingPauseSource, BridgePauseSource, BridgeRegistry, EvmPausedSource } from '../types/protocol.js'
import type { BridgeRouteStatus, BridgeRouteStatusSource, GetRouteStatusParameters } from '../types/actions.js'

// OpenZeppelin Pausable view shared by xReserve and CCTP MessageTransmitterV2.
const PAUSABLE_ABI = parseAbi(['function paused() view returns (bool)'])

/**
 * Reads every on-chain pause flag a route depends on and reports whether the route is halted.
 *
 * Each route in the registry declares the Aleo mappings and EVM contracts whose
 * pause flag makes its transactions fail on chain. The action reads them all in
 * parallel through the configured public clients and never throws for a flag
 * it cannot read: a failed read is reported as `unknown`, and a flag on a chain
 * with no configured client is reported as `skipped`. It does not sign, prove,
 * or submit anything.
 *
 * @param registry Supported chains, assets, and reviewed deployments carrying the pause flag locations.
 * @param clients Public chain access keyed by registry chain id. Only read capabilities are used.
 * @param params Directional route whose flags are read.
 * @returns The route id, whether any flag read as paused, and every flag with its read outcome.
 * @throws BridgeError When the route id is not in the registry.
 * @example
 * const status = await getRouteStatus(registry, clients, { routeId: 'hyperlane:aleo/eth->ethereum/eth' })
 * if (status.paused) console.log(status.sources.filter((source) => source.state === 'paused'))
 */
export async function getRouteStatus(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  params: GetRouteStatusParameters,
): Promise<BridgeRouteStatus> {
  const route = registry.routes.find((entry) => entry.id === params.routeId)
  if (!route) throw new BridgeError(`Unknown bridge route: ${params.routeId}`)
  const sources = await Promise.all((route.pauseSources ?? []).map((source) => probe(clients, source)))
  return {
    routeId: route.id,
    paused: sources.some((source) => source.state === 'paused'),
    sources,
  }
}

/** Reads one flag, converting any failure into a reported outcome rather than a thrown error. */
async function probe(clients: BridgeChainClients, source: BridgePauseSource): Promise<BridgeRouteStatusSource> {
  const client = clients[source.chainId]
  if (!client) return { ...source, state: 'skipped', reason: `No client configured for chain ${source.chainId}` }
  try {
    const paused = source.kind === 'aleo-mapping'
      ? await readAleoFlag(client, source)
      : await readEvmFlag(client, source)
    return { ...source, state: paused ? 'paused' : 'active' }
  } catch (error) {
    return { ...source, state: 'unknown', reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Reads a boolean Aleo mapping; an absent key means the program never set its flag and is unpaused. */
async function readAleoFlag(client: BridgeChainClient, source: AleoMappingPauseSource): Promise<boolean> {
  if (client.family !== 'aleo') throw new BridgeError(`Chain ${source.chainId} is not configured as an Aleo chain`)
  const value = await client.publicClient.request({
    method: 'getMappingValue',
    params: { programId: source.program, mapping: source.mapping, key: source.key },
  })
  if (value === null || value === undefined) return false
  if (value === 'true') return true
  if (value === 'false') return false
  throw new BridgeError(`Unexpected ${source.program}/${source.mapping}[${source.key}] value: ${String(value)}`)
}

/** Calls `paused()` on an EVM contract and decodes the boolean result. */
async function readEvmFlag(client: BridgeChainClient, source: EvmPausedSource): Promise<boolean> {
  if (client.family !== 'evm') throw new BridgeError(`Chain ${source.chainId} is not configured as an EVM chain`)
  const data = await client.publicClient.call({
    to: getAddress(source.address),
    data: encodeFunctionData({ abi: PAUSABLE_ABI, functionName: 'paused' }),
  })
  return decodeFunctionResult({ abi: PAUSABLE_ABI, functionName: 'paused', data })
}
