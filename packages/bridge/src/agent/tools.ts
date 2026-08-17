import type { AgentTool } from '@provablehq/veil-core/agent'
import type { BridgeClient } from '../clients/createBridgeClient.js'

/**
 * Builds read-only discovery and non-fund-moving planning tools.
 *
 * The current tool set cannot sign or submit transactions. A later execution
 * phase adds privileged tools only after xReserve and Hyperlane adapters expose
 * inspectable transaction plans.
 *
 * @param client Protocol bridge client supplying registry-bound actions.
 * @returns Agent tools for asset discovery, route discovery, and transfer planning.
 *
 * @example
 * const tools = createBridgeAgentTools(createBridgeClient())
 */
export function createBridgeAgentTools(client: BridgeClient): AgentTool[] {
  return [
    {
      schema: {
        name: 'bridge_list_routes',
        description: 'List directional protocol routes. USDCx routes use Circle xReserve; ETH, WBTC, SOL, ALEO, and USAD routes use Hyperlane. metadata-required means the route is known but its execution deployment is not pinned yet.',
        inputSchema: {
          type: 'object',
          properties: {
            environment: { type: 'string', enum: ['mainnet', 'testnet'] },
            chainId: { type: 'string' },
            symbol: { type: 'string' },
          },
        },
      },
      handler: async (params) => client.getAssets(params),
    },
    {
      schema: {
        name: 'bridge_list_routes',
        description: 'List directional protocol routes. USDCx routes use Circle xReserve; ETH, WBTC, SOL, ALEO, and USAD routes use Hyperlane. metadata-required means the route is known but its execution deployment is not pinned yet.',
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
      handler: async (params) => client.getRoutes(params),
    },
    {
      schema: {
        name: 'bridge_prepare_transfer',
        description: 'Validate a route, amount, and recipient, then return the ordered xReserve or Hyperlane execution plan. This tool is pure and local: it does not query fees, sign transactions, or move funds.',
        inputSchema: {
          type: 'object',
          properties: {
            routeId: { type: 'string' },
            amount: { type: 'string', description: 'Positive decimal amount in source-asset display units.' },
            recipient: { type: 'string' },
            sender: { type: 'string' },
            privateRecipient: { type: 'boolean' },
          },
          required: ['routeId', 'amount', 'recipient'],
        },
      },
      handler: async (params) => client.prepareTransfer(params as Parameters<BridgeClient['prepareTransfer']>[0]),
    },
  ]
}
