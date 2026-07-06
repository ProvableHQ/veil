import type { AgentTool } from '@veil/core/agent'
import type { BridgeClient } from '../clients/createBridgeClient.js'

/**
 * Builds the bridge's agent tools in core's `AgentTool` shape
 * (`{ schema, handler }`), bound to a {@link BridgeClient}.
 *
 * Feed the result to any agent framework (LangChain, Vercel AI SDK, …) or to
 * core's `toMcpServer` — including concatenated with other packages' tools
 * (`toMcpServer([...createAgentTools(cfg), ...createBridgeAgentTools(client)])`).
 * Handlers proxy to the client's actions, so every call hits the live
 * wallet-services API.
 *
 * The `bridge_swap` tool additionally requires the client to have been built
 * with a `@veil/core` WalletClient (it signs and broadcasts the Aleo deposit);
 * only expose it to agents you intend to let move funds.
 *
 * @param client A bridge client from `createBridgeClient`.
 * @returns One tool per bridge action, `bridge_`-prefixed.
 *
 * @example
 * import { toMcpServer } from '@veil/core/mcp'
 * const server = toMcpServer(createBridgeAgentTools(client))
 * const flags = await server.handleToolCall('bridge_get_flags', {})
 */
export function createBridgeAgentTools(client: BridgeClient): AgentTool[] {
  return [
    {
      schema: {
        name: 'bridge_list_assets',
        description:
          'List the bridge\'s asset catalog — the source of truth for identifiers. Each entry has the chain-qualified code (ALEO_MAINNET, USDC_ETH) used as srcAsset/destAsset, the case-sensitive chain id (ALEO, SOLANA, EVM:1) used as srcChain/destChain, decimals bounding amount precision, a wallet-address validation regex, and which providers can route it. Call this FIRST — do not guess asset codes or chain ids.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: () => client.getAssets(),
    },
    {
      schema: {
        name: 'bridge_list_providers',
        description:
          'List the registered providers. Entries with BRIDGE in capabilities are swap providers; BUY/SELL are fiat ramps. Registry presence does not guarantee a provider currently quotes — per-asset supportedProviders (bridge_list_assets) and a live bridge_get_quotes are authoritative.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: () => client.getProviders(),
    },
    {
      schema: {
        name: 'bridge_list_routes',
        description:
          'List candidate bridge routes derived from the asset catalog: pairs of assets (one always on Aleo) that share a supporting provider. Each side carries its code, chain id, human-readable chainName, decimals, and address regex — everything a follow-up quote needs. Candidates mean supportability, not liveness or direction; confirm with bridge_get_quotes. Use this to answer "what can move where" instead of guessing pairs.',
        inputSchema: {
          type: 'object',
          properties: {
            externalChain: { type: 'string', description: 'Only routes whose external side is on this chain — by id (SOLANA, EVM:1) or display name (Solana, Ethereum), case-insensitive.' },
            symbol: { type: 'string', description: 'Only routes where either side has exactly this symbol (e.g. USDC).' },
            provider: { type: 'string', description: 'Only routes this provider supports (e.g. NEAR_INTENTS).' },
          },
        },
      },
      handler: (params) => client.getRoutes(params as Parameters<BridgeClient['getRoutes']>[0]),
    },
    {
      schema: {
        name: 'bridge_get_flags',
        description:
          'Fetch the bridge\'s server-side feature flags (e.g. near_supports_pub_priv_swaps). Check these before proposing routes gated by provider capabilities.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: () => client.getFlags(),
    },
    {
      schema: {
        name: 'bridge_get_quotes',
        description:
          'Fetch cross-chain swap quotes where Aleo is one side of the pair. Returns one quote per enabled provider plus a meta block with quoteRequestId for support and any provider warnings/errors. Pass recipientAddress and refundAddress (or fromAddress) — some providers (NEAR Intents) skip quoting without them. Asset codes are chain-qualified (ALEO_MAINNET, USDC_ALEO, ETH_BASE), not bare symbols.',
        inputSchema: {
          type: 'object',
          properties: {
            srcChain: { type: 'string', description: 'Source chain identifier (e.g. ALEO, SOLANA, EVM:1, BITCOIN).' },
            srcAsset: { type: 'string', description: 'Chain-qualified source asset code (e.g. ALEO_MAINNET).' },
            destChain: { type: 'string', description: 'Destination chain identifier.' },
            destAsset: { type: 'string', description: 'Chain-qualified destination asset code (e.g. SOL_SOLANA).' },
            amountIn: { type: 'string', description: 'Decimal source amount as a string, at most the asset\'s decimals.' },
            slippageBps: { type: 'string', description: 'Optional slippage tolerance in basis points (decimal string).' },
            fromAddress: { type: 'string', description: 'Optional source-chain wallet address; doubles as the default recipient/refund address.' },
            recipientAddress: { type: 'string', description: 'Destination-chain recipient address. Strongly recommended: providers may skip quoting without it.' },
            refundAddress: { type: 'string', description: 'Source-chain refund address. Strongly recommended: providers may skip quoting without it.' },
          },
          required: ['srcChain', 'srcAsset', 'destChain', 'destAsset', 'amountIn'],
        },
      },
      handler: (params) => client.getQuotes(params as Parameters<BridgeClient['getQuotes']>[0]),
    },
    {
      schema: {
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
      },
      handler: (params) => client.createOrder(params as Parameters<BridgeClient['createOrder']>[0]),
    },
    {
      schema: {
        name: 'bridge_get_order',
        description: 'Fetch the current BridgeOrderStatusDto for a bridge order by id.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      handler: (params) => client.getOrder(params as Parameters<BridgeClient['getOrder']>[0]),
    },
    {
      schema: {
        name: 'bridge_get_order_audit',
        description: 'Fetch the BridgeOrderAuditDto (status DTO plus per-step + provider event timeline) for a bridge order.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      handler: (params) => client.getOrderAudit(params as Parameters<BridgeClient['getOrderAudit']>[0]),
    },
    {
      schema: {
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
      },
      handler: (params) => client.waitForOrder(params as Parameters<BridgeClient['waitForOrder']>[0]),
    },
    {
      schema: {
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
                chain: { type: 'string', description: 'Destination chain — id (SOLANA, EVM:1) or display name (Solana, Ethereum).' },
                asset: { type: 'string', description: 'Chain-qualified destination asset code (e.g. SOL_SOLANA).' },
                address: { type: 'string', description: 'Destination-chain recipient the provider pays out to.' },
              },
              required: ['chain', 'asset', 'address'],
            },
            refundAddress: { type: 'string', description: 'Aleo address a failed swap refunds to. Defaults to the signing wallet\'s address.' },
            merkleProof: { type: 'string', description: 'Pre-formatted [MerkleProof; 2u32] input string. Required only for compliance-bearing source assets (e.g. USDCX_ALEO, USAD_ALEO).' },
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
      },
      handler: (params) => client.swap(params as unknown as Parameters<BridgeClient['swap']>[0]),
    },
  ]
}
