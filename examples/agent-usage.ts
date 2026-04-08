/**
 * Agent Usage: how an AI agent interacts with Aleo through veil
 *
 * This example shows the agent-first design of veil. An agent:
 *   1. Never imports @provablehq/sdk or any wallet adapter
 *   2. Gets a set of tools with structured JSON schemas
 *   3. Calls tools by name with JSON input, gets JSON output
 *   4. Can discover programs and read state without knowing Aleo internals
 *
 * The tools are framework-agnostic — they work with LangChain, Vercel AI SDK,
 * or any system that can call functions with JSON arguments.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createPublicClient,
  custom,
} from '@veil/core'
import {
  aleoAgentTools,
  aleoAgentToolSchemas,
  createAgentTools,
  publicToolSchemas,
} from '@veil/core/agent'

// ---------------------------------------------------------------------------
// Mock transport — simulates Aleo network responses
// ---------------------------------------------------------------------------

const CREDITS_SOURCE = `program credits.aleo;

mapping account:
    key as address.public;
    value as u64.public;

mapping committee:
    key as address.public;
    value as u128.public;

function transfer_public:
    input r0 as address.public;
    input r1 as u64.public;

finalize transfer_public:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as u64.public;

function transfer_private:
    input r0 as credits.record;
    input r1 as address.private;
    input r2 as u64.private;

function bond_public:
    input r0 as address.public;
    input r1 as u64.public;

finalize bond_public:
    input r0 as address.public;
    input r1 as u64.public;
`

const mockRequest = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
  const p = params as Record<string, unknown> | undefined
  switch (method) {
    case 'getLatestHeight':
      return 20_500_000
    case 'getBalance':
      return '42000000u64'
    case 'getMappingValue':
      // Return different values based on the mapping being queried
      if (p?.mapping === 'account') return '42000000u64'
      if (p?.mapping === 'committee') return '1000000000000u128'
      return '0u64'
    case 'getProgram':
      return CREDITS_SOURCE
    case 'getBlock':
      return { block_hash: 'ab1mock', header: { height: 20_500_000 } }
    case 'getTransaction':
      return { id: 'at1mock', status: 'accepted' }
    default:
      throw new Error(`Unhandled: ${method}`)
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent Usage: tool-based interaction with Aleo', () => {
  // Step 1: Create a public client — this is the only setup the host does
  const publicClient = createPublicClient({
    transport: custom({ request: mockRequest }),
  })

  // Step 2: Generate agent tools from the client
  const tools = aleoAgentTools({ client: publicClient })

  // Helper to call a tool by name, simulating what an LLM framework does
  function callTool(name: string, input: Record<string, unknown> = {}) {
    const tool = tools.find((t) => t.name === name)
    if (!tool) throw new Error(`Tool not found: ${name}`)
    return tool.handler(input)
  }

  it('tools have structured JSON schemas for LLM consumption', () => {
    // An agent framework registers these schemas so the LLM knows
    // what tools are available and what arguments they accept
    const schemas = publicToolSchemas

    // Each schema has a name, description, and JSON Schema for inputs
    for (const schema of schemas) {
      expect(schema.name).toMatch(/^aleo_/)
      expect(schema.description).toBeTruthy()
      expect(schema.inputSchema).toBeDefined()
      expect(schema.inputSchema.type).toBe('object')
    }

    // The schemas tell the LLM exactly what's available
    const toolNames = schemas.map((s) => s.name)
    expect(toolNames).toContain('aleo_get_block_number')
    expect(toolNames).toContain('aleo_get_balance')
    expect(toolNames).toContain('aleo_read_mapping')
    expect(toolNames).toContain('aleo_describe_program')
    expect(toolNames).toContain('aleo_get_program')
    expect(toolNames).toContain('aleo_get_block')
    expect(toolNames).toContain('aleo_get_transaction')
  })

  it('aleoAgentToolSchemas() returns schemas without handlers (for registration only)', () => {
    // Useful when you only need to tell the LLM what tools exist,
    // but handle execution separately (e.g., MCP server pattern)
    const schemas = aleoAgentToolSchemas({ client: publicClient })
    expect(schemas.length).toBeGreaterThan(0)

    // These are pure schemas — no handler attached
    for (const schema of schemas) {
      expect(schema).toHaveProperty('name')
      expect(schema).toHaveProperty('description')
      expect(schema).toHaveProperty('inputSchema')
      expect(schema).not.toHaveProperty('handler')
    }
  })

  it('createAgentTools() returns schema+handler pairs', () => {
    // Alternative shape where schema and handler are separate fields
    const agentTools = createAgentTools({ client: publicClient })
    expect(agentTools.length).toBeGreaterThan(0)

    for (const tool of agentTools) {
      expect(tool.schema).toBeDefined()
      expect(tool.schema.name).toMatch(/^aleo_/)
      expect(tool.handler).toBeInstanceOf(Function)
    }
  })

  // -------------------------------------------------------------------------
  // Scenario: An agent discovers a program and reads its state
  // -------------------------------------------------------------------------

  describe('Scenario: agent discovers and reads from credits.aleo', () => {
    it('Step 1: discover what credits.aleo can do (aleo_describe_program)', async () => {
      // The agent asks: "What functions does credits.aleo have?"
      const result = await callTool('aleo_describe_program', {
        program: 'credits.aleo',
      }) as Record<string, unknown>

      // The response is structured JSON the agent can reason about
      expect(result.program).toBe('credits.aleo')

      const functions = result.functions as Array<Record<string, unknown>>
      expect(functions.length).toBeGreaterThan(0)

      // The agent can see function signatures
      const transferPublic = functions.find((f) => f.name === 'transfer_public')
      expect(transferPublic).toBeDefined()
      expect(transferPublic!.hasFinalize).toBe(true)

      // The agent can see available mappings (on-chain state)
      const mappings = result.mappings as Array<Record<string, unknown>>
      expect(mappings.length).toBeGreaterThan(0)

      const accountMapping = mappings.find((m) => m.name === 'account')
      expect(accountMapping).toBeDefined()
      expect(accountMapping!.keyType).toBe('address')
      expect(accountMapping!.valueType).toBe('u64')
    })

    it('Step 2: read a balance using the mapping (aleo_read_mapping)', async () => {
      // Now the agent knows credits.aleo has an "account" mapping
      // keyed by address, returning u64. It reads a value:
      const result = await callTool('aleo_read_mapping', {
        program: 'credits.aleo',
        mapping: 'account',
        key: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      }) as Record<string, unknown>

      // Structured response includes context about what was queried
      expect(result.value).toBe('42000000u64')
      expect(result.program).toBe('credits.aleo')
      expect(result.mapping).toBe('account')
    })

    it('Step 3: check balance via the convenience tool (aleo_get_balance)', async () => {
      // For credits specifically, there's a convenience tool
      const result = await callTool('aleo_get_balance', {
        address: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      }) as Record<string, unknown>

      // Returns balance with unit context
      expect(result.balance).toBe('42000000')
      expect(result.unit).toBe('microcredits')
    })

    it('Step 4: check chain liveness (aleo_get_block_number)', async () => {
      const result = await callTool('aleo_get_block_number') as Record<string, unknown>
      expect(result.height).toBe('20500000')
    })
  })

  // -------------------------------------------------------------------------
  // Key insight: the agent never imported @provablehq/sdk or any wallet.
  // It only uses tool names and JSON. This is the agent-first design.
  // -------------------------------------------------------------------------

  it('agent tools produce pure JSON — no SDK types leak through', async () => {
    // Every tool response is a plain object serializable to JSON
    const responses = await Promise.all([
      callTool('aleo_get_block_number'),
      callTool('aleo_get_balance', { address: 'aleo1abc' }),
      callTool('aleo_describe_program', { program: 'credits.aleo' }),
      callTool('aleo_read_mapping', {
        program: 'credits.aleo',
        mapping: 'account',
        key: 'aleo1abc',
      }),
    ])

    for (const response of responses) {
      // Every response round-trips through JSON without loss
      const serialized = JSON.stringify(response)
      const deserialized = JSON.parse(serialized)
      expect(deserialized).toEqual(response)
    }
  })
})
