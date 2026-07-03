import type { BridgeClient } from '../clients/createBridgeClient.js'

export type McpToolSchema = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export type McpTool = {
  name: string
  description: string
  inputSchema: McpToolSchema
  handler: (params: any) => Promise<unknown>
}

export function buildBridgeMcpTools(client: BridgeClient): McpTool[] {
  return [
    {
      name: 'bridge_get_flags',
      description:
        'Fetch the bridge\'s server-side feature flags (e.g. near_supports_pub_priv_swaps). Check these before proposing routes gated by provider capabilities.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: () => client.getFlags(),
    },
    {
      name: 'bridge_get_quotes',
      description:
        'Fetch cross-chain swap quotes where Aleo is one side of the pair. Returns one quote per enabled provider plus a meta block with quoteRequestId for support and any provider warnings/errors.',
      inputSchema: {
        type: 'object',
        properties: {
          srcChain: { type: 'string', description: 'Source chain identifier.' },
          srcAsset: { type: 'string', description: 'Source asset symbol or address.' },
          destChain: { type: 'string', description: 'Destination chain identifier.' },
          destAsset: { type: 'string', description: 'Destination asset symbol or address.' },
          amountIn: { type: 'string', description: 'Decimal source amount as a string.' },
          slippageBps: { type: 'string', description: 'Optional slippage tolerance in basis points (decimal string).' },
          fromAddress: { type: 'string', description: 'Optional source-chain wallet address.' },
          recipientAddress: { type: 'string', description: 'Optional destination-chain recipient address.' },
          refundAddress: { type: 'string', description: 'Optional source-chain refund address.' },
        },
        required: ['srcChain', 'srcAsset', 'destChain', 'destAsset', 'amountIn'],
      },
      handler: (params) => client.getQuotes(params),
    },
    {
      name: 'bridge_create_order',
      description:
        'Create a bridge order from a previously-fetched quote. Returns the BridgeOrderInstructions (deposit address, amount, chain, optional memo) the wallet must satisfy to start the swap.',
      inputSchema: {
        type: 'object',
        properties: {
          providerId: { type: 'string' },
          srcChain: { type: 'string' },
          srcAsset: { type: 'string' },
          destChain: { type: 'string' },
          destAsset: { type: 'string' },
          amountIn: { type: 'string' },
          walletAddress: { type: 'string' },
          quoteId: { type: 'string' },
          integrationType: { type: 'string', enum: ['CEX', 'DEX'] },
          slippageBps: { type: 'string' },
          refundAddress: { type: 'string' },
          timezone: { type: 'string', description: 'Optional IANA timezone; hoisted to x-timezone header.' },
        },
        required: [
          'providerId',
          'srcChain',
          'srcAsset',
          'destChain',
          'destAsset',
          'amountIn',
          'walletAddress',
          'quoteId',
        ],
      },
      handler: (params) => client.createOrder(params),
    },
    {
      name: 'bridge_get_order',
      description: 'Fetch the current BridgeOrderStatusDto for a bridge order by id.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      handler: (params) => client.getOrder(params),
    },
    {
      name: 'bridge_get_order_audit',
      description: 'Fetch the BridgeOrderAuditDto (status DTO plus per-step + provider event timeline) for a bridge order.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      handler: (params) => client.getOrderAudit(params),
    },
    {
      name: 'bridge_wait_for_order',
      description: 'Poll a bridge order until it reaches the target stage value (status field) or fails terminally.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          until: { type: 'string', description: 'Target stage value (default COMPLETED).' },
          pollIntervalMs: { type: 'number' },
          timeoutMs: { type: 'number' },
        },
        required: ['id'],
      },
      handler: (params) => client.waitForOrder(params),
    },
    {
      name: 'bridge_swap',
      description:
        'End-to-end Aleo-source bridge swap: quote → select → order → Aleo unshield deposit (routed through the asset\'s Aleo program) → optional poll to completion. Requires a @veil/core WalletClient (passed in by the SDK host, not the agent).',
      inputSchema: {
        type: 'object',
        properties: {
          from: {
            type: 'object',
            properties: {
              asset: { type: 'string' },
              amount: { type: 'string' },
            },
            required: ['asset', 'amount'],
          },
          to: {
            type: 'object',
            properties: {
              chain: { type: 'string' },
              asset: { type: 'string' },
              address: { type: 'string' },
            },
            required: ['chain', 'asset', 'address'],
          },
          merkleProof: { type: 'string', description: 'Pre-formatted [MerkleProof; 2u32] input string. Required only for compliance-bearing source assets (e.g. USDCX, USAD).' },
          selectQuote: {
            description: 'best (highest amountOut), fastest (lowest estimatedTimeSeconds), or a callback (callbacks are only available to in-process callers, not to JSON agents).',
            oneOf: [
              { type: 'string', enum: ['best', 'fastest'] },
            ],
          },
          poll: {
            description: 'false → return after deposit submission; true → wait for COMPLETED; specific stage string → wait for that stage.',
            oneOf: [
              { type: 'boolean' },
              { type: 'string' },
            ],
          },
          timezone: { type: 'string' },
        },
        required: ['from', 'to'],
      },
      handler: (params) => client.swap(params),
    },
  ]
}
