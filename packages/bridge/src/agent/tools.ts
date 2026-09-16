import type { AgentTool } from '@provablehq/veil-core/agent'
import type { BridgeClient } from '../clients/createBridgeClient.js'
import type { GetAssetsParameters, GetRoutesParameters } from '../types/protocol.js'

/**
 * Creates tools an agent can use to discover and describe cross-chain transfers.
 *
 * The tools list supported assets and routes, validate an amount and recipient,
 * and quote current costs when the selected route exposes them. They cannot
 * request a signature, submit a transaction, or move funds.
 *
 * @param client Bridge client supplying the supported asset and route catalog.
 * @returns Non-fund-moving agent tools for discovering and describing transfers.
 *
 * @example
 * const tools = createBridgeAgentTools(createBridgeClient())
 */
export function createBridgeAgentTools(client: BridgeClient): AgentTool[] {
  return [
    {
      schema: {
        name: 'bridge_list_assets',
        description: 'List assets available for cross-chain transfers. Returns each chain representation, symbol, decimal precision, and public token identifier without contacting a chain or wallet.',
        inputSchema: {
          type: 'object',
          properties: {
            environment: { type: 'string', enum: ['mainnet', 'testnet'] },
            chainId: { type: 'string' },
            symbol: { type: 'string' },
          },
        },
      },
      handler: async (params) => {
        const filters = params as GetAssetsParameters
        return client.registry.getAssets({
          ...filters,
          environment: filters.environment ?? client.environment,
        })
      },
    },
    {
      schema: {
        name: 'bridge_list_routes',
        description: 'List supported ways to move assets between chains and the provider responsible for each direction. A metadata-required route is recognized but cannot move funds until its deployed contracts or programs are reviewed.',
        inputSchema: {
          type: 'object',
          properties: {
            environment: { type: 'string', enum: ['mainnet', 'testnet'] },
            protocol: { type: 'string', enum: ['xreserve', 'hyperlane'] },
            sourceChainId: { type: 'string' },
            destinationChainId: { type: 'string' },
            symbol: { type: 'string' },
            includeUnavailable: { type: 'boolean' },
          },
        },
      },
      handler: async (params) => {
        const filters = params as GetRoutesParameters
        return client.registry.getRoutes({
          ...filters,
          environment: filters.environment ?? client.environment,
        })
      },
    },
    {
      schema: {
        name: 'bridge_quote_transfer',
        description: 'Validate and price an intended transfer between two chains through xReserve or Hyperlane. This tool reads current chain or provider state where the selected route exposes live costs, but does not request a wallet signature or move funds.',
        inputSchema: {
          type: 'object',
          properties: {
            source: {
              type: 'object',
              properties: { chain: { type: 'string' }, asset: { type: 'string' } },
              required: ['chain', 'asset'],
            },
            destination: {
              type: 'object',
              properties: { chain: { type: 'string' }, asset: { type: 'string' } },
              required: ['chain', 'asset'],
            },
            bridgeProtocol: { type: 'string', enum: ['xreserve', 'hyperlane'] },
            amount: { type: 'string', description: 'Positive decimal amount in source-asset display units.' },
            recipient: { type: 'string' },
            sender: { type: 'string' },
            mintMode: { type: 'string', enum: ['public', 'record', 'private'] },
          },
          required: ['source', 'destination', 'amount', 'recipient'],
        },
      },
      handler: async (params) => jsonSafe(await client.quote(params as Parameters<BridgeClient['quote']>[0])),
    },
  ]
}

/** Converts atomic bigint amounts into decimal strings accepted by JSON-based agent transports. */
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]),
    )
  }
  return value
}
