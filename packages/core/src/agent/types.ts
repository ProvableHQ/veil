import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'

export type AgentToolSchema = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export type AgentToolHandler = (params: Record<string, unknown>) => Promise<unknown>

export type AgentTool = {
  schema: AgentToolSchema
  handler: AgentToolHandler
}

/** @deprecated Use AgentTool instead */
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
