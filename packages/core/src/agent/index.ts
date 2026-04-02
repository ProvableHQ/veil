import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'

export type AgentToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (input: Record<string, unknown>) => Promise<unknown>
}

export type AgentToolsConfig = {
  client?: PublicClient
  walletClient?: WalletClient
}

/**
 * Returns agent tool definitions + execution handlers for all available actions.
 * Framework-agnostic — can be consumed by LangChain, Vercel AI SDK, etc.
 *
 * Exposed via subpath export: import { aleoAgentTools } from '@aleo-viem/core/agent'
 */
export function aleoAgentTools(config: AgentToolsConfig): AgentToolDefinition[] {
  const tools: AgentToolDefinition[] = []

  if (config.client) {
    const client = config.client

    tools.push({
      name: 'aleo_get_block_number',
      description: 'Get the current Aleo chain height. Equivalent to viem\'s getBlockNumber.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const height = await client.getBlockNumber()
        return { height: String(height) }
      },
    })

    tools.push({
      name: 'aleo_get_balance',
      description: 'Get the public credits balance for an Aleo address. Returns balance in microcredits.',
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Aleo address (aleo1...)' },
        },
        required: ['address'],
      },
      handler: async (input) => {
        const balance = await client.getBalance({ address: input.address as string })
        return { balance: String(balance), unit: 'microcredits' }
      },
    })

    tools.push({
      name: 'aleo_read_mapping',
      description: 'Read a value from an Aleo program\'s public mapping. Equivalent to viem\'s readContract.',
      inputSchema: {
        type: 'object',
        properties: {
          program: { type: 'string', description: 'Program ID, e.g. \'credits.aleo\'' },
          mapping: { type: 'string', description: 'Mapping name, e.g. \'account\'' },
          key: { type: 'string', description: 'Key to look up' },
        },
        required: ['program', 'mapping', 'key'],
      },
      handler: async (input) => {
        const value = await client.readContract({
          program: input.program as string,
          mapping: input.mapping as string,
          key: input.key as string,
        })
        return { value }
      },
    })

    tools.push({
      name: 'aleo_get_program',
      description: 'Fetch the source code of a deployed Aleo program. Equivalent to viem\'s getCode.',
      inputSchema: {
        type: 'object',
        properties: {
          program: { type: 'string', description: 'Program ID, e.g. \'credits.aleo\'' },
        },
        required: ['program'],
      },
      handler: async (input) => {
        const source = await client.getCode({ program: input.program as string })
        return { source }
      },
    })
  }

  if (config.walletClient) {
    const walletClient = config.walletClient

    tools.push({
      name: 'aleo_execute',
      description: 'Execute a transition on an Aleo program. Equivalent to viem\'s writeContract. Returns transaction ID.',
      inputSchema: {
        type: 'object',
        properties: {
          program: { type: 'string' },
          function: { type: 'string' },
          inputs: { type: 'array', items: { type: 'string' } },
          fee: { type: 'number', description: 'Fee in microcredits' },
        },
        required: ['program', 'function', 'inputs'],
      },
      handler: async (input) => {
        const txId = await walletClient.writeContract({
          program: input.program as string,
          function: input.function as string,
          inputs: input.inputs as string[],
          fee: BigInt((input.fee as number) ?? 0),
        })
        return { transactionId: txId }
      },
    })

    tools.push({
      name: 'aleo_transfer',
      description: 'Transfer Aleo credits to another address. Convenience wrapper around credits.aleo.',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient Aleo address' },
          amount: { type: 'number', description: 'Amount in microcredits' },
        },
        required: ['to', 'amount'],
      },
      handler: async (input) => {
        const txId = await walletClient.transfer({
          to: input.to as string,
          amount: BigInt(input.amount as number),
        })
        return { transactionId: txId }
      },
    })
  }

  return tools
}
