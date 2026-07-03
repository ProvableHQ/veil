import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'

/**
 * Declares one agent tool in a framework-neutral shape.
 *
 * Maps directly onto MCP's tool declaration and onto the tool/function shapes
 * of LangChain, the Vercel AI SDK, and the Claude and OpenAI APIs, so one
 * schema serves every framework.
 *
 * @property name Tool identifier the model calls, e.g. `aleo_get_balance`.
 * @property description What the model reads to decide when to call the tool.
 * @property inputSchema JSON Schema (object type) for the tool's arguments.
 */
export type AgentToolSchema = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/**
 * Executes one tool call: takes the arguments the model produced and resolves
 * to structured JSON for the model to read.
 *
 * Handlers built by `createPublicHandlers` and `createWalletHandlers` reach
 * the network through the client they were constructed with; wallet handlers
 * also sign, prove, and pay fees.
 */
export type AgentToolHandler = (params: Record<string, unknown>) => Promise<unknown>

/**
 * Pairs a tool's schema with the handler that executes it.
 *
 * The unit that `createAgentTools` returns and `toMcpServer` consumes; adapt
 * it to any agent framework by registering `schema` and routing calls to
 * `handler`.
 *
 * @property schema Declaration the model sees.
 * @property handler Function invoked when the model calls the tool.
 */
export type AgentTool = {
  schema: AgentToolSchema
  handler: AgentToolHandler
}

/**
 * Flattened tool shape with the handler alongside the schema fields, as
 * returned by `aleoAgentTools`.
 *
 * @deprecated Use AgentTool instead
 */
export type AgentToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (input: Record<string, unknown>) => Promise<unknown>
}

/**
 * Selects which tool sets the agent factories produce.
 *
 * Pass only `client` for a read-only agent; add `walletClient` to let the
 * agent sign, spend, and deploy.
 *
 * @property client Backs the read-only tools; when absent they are omitted.
 * @property walletClient Backs the write tools (execute, transfer, deploy);
 *   when absent they are omitted.
 */
export type AgentToolsConfig = {
  client?: PublicClient
  walletClient?: WalletClient
}
