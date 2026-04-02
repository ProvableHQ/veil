import { describe, it, expect, vi } from 'vitest'
import { aleoAgentTools, aleoAgentToolSchemas, createAgentTools } from '../../src/agent/index.js'
import { createPublicClient } from '../../src/clients/createPublicClient.js'
import { createWalletClient } from '../../src/clients/createWalletClient.js'
import { custom } from '../../src/transports/custom.js'

describe('aleoAgentTools', () => {
  describe('with public client only', () => {
    it('returns read-only tools', () => {
      const request = vi.fn()
      const client = createPublicClient({ transport: custom({ request }) })
      const tools = aleoAgentTools({ client })

      const names = tools.map((t) => t.name)
      expect(names).toContain('aleo_get_block_number')
      expect(names).toContain('aleo_get_balance')
      expect(names).toContain('aleo_read_mapping')
      expect(names).toContain('aleo_get_program')
      expect(names).toContain('aleo_get_block')
      expect(names).toContain('aleo_get_transaction')
      expect(names).toContain('aleo_describe_program')
      // No wallet tools
      expect(names).not.toContain('aleo_execute')
      expect(names).not.toContain('aleo_transfer')
      expect(names).not.toContain('aleo_deploy')
    })

    it('tools have correct structure', () => {
      const request = vi.fn()
      const client = createPublicClient({ transport: custom({ request }) })
      const tools = aleoAgentTools({ client })

      for (const tool of tools) {
        expect(tool.name).toBeTypeOf('string')
        expect(tool.description).toBeTypeOf('string')
        expect(tool.inputSchema).toBeTypeOf('object')
        expect(tool.handler).toBeTypeOf('function')
        expect(tool.inputSchema.type).toBe('object')
      }
    })

    it('aleo_get_block_number handler calls client and returns structured JSON', async () => {
      const request = vi.fn().mockResolvedValue(42000)
      const client = createPublicClient({ transport: custom({ request }) })
      const tools = aleoAgentTools({ client })

      const tool = tools.find((t) => t.name === 'aleo_get_block_number')!
      const result = await tool.handler({})

      expect(result).toEqual({ height: '42000' })
      expect(typeof (result as any).height).toBe('string')
    })

    it('aleo_get_balance handler calls client and returns structured JSON', async () => {
      const request = vi.fn().mockResolvedValue('5000000u64')
      const client = createPublicClient({ transport: custom({ request }) })
      const tools = aleoAgentTools({ client })

      const tool = tools.find((t) => t.name === 'aleo_get_balance')!
      const result = await tool.handler({ address: 'aleo1owner' })

      expect(result).toEqual({ balance: '5000000', unit: 'microcredits', address: 'aleo1owner' })
    })

    it('aleo_read_mapping handler calls readContract', async () => {
      const request = vi.fn().mockResolvedValue('42u64')
      const client = createPublicClient({ transport: custom({ request }) })
      const tools = aleoAgentTools({ client })

      const tool = tools.find((t) => t.name === 'aleo_read_mapping')!
      const result = await tool.handler({
        program: 'token.aleo',
        mapping: 'balances',
        key: 'aleo1owner',
      })

      expect(result).toEqual({
        value: '42u64',
        program: 'token.aleo',
        mapping: 'balances',
        key: 'aleo1owner',
      })
    })

    it('aleo_get_program handler calls getCode', async () => {
      const request = vi.fn().mockResolvedValue('program token.aleo;')
      const client = createPublicClient({ transport: custom({ request }) })
      const tools = aleoAgentTools({ client })

      const tool = tools.find((t) => t.name === 'aleo_get_program')!
      const result = await tool.handler({ program: 'token.aleo' })

      expect(result).toEqual({ source: 'program token.aleo;', program: 'token.aleo' })
    })

    it('aleo_get_block handler calls getBlock', async () => {
      const mockBlock = { header: { height: 100 } }
      const request = vi.fn().mockResolvedValue(mockBlock)
      const client = createPublicClient({ transport: custom({ request }) })
      const tools = aleoAgentTools({ client })

      const tool = tools.find((t) => t.name === 'aleo_get_block')!
      const result = await tool.handler({ height: 100 })

      expect(result).toEqual({ block: mockBlock })
    })

    it('aleo_get_transaction handler calls getTransaction', async () => {
      const mockTx = { id: 'at1abc', status: 'accepted' }
      const request = vi.fn().mockResolvedValue(mockTx)
      const client = createPublicClient({ transport: custom({ request }) })
      const tools = aleoAgentTools({ client })

      const tool = tools.find((t) => t.name === 'aleo_get_transaction')!
      const result = await tool.handler({ id: 'at1abc' })

      expect(result).toEqual({ transaction: mockTx })
    })

    it('aleo_describe_program handler fetches and parses program', async () => {
      const programSource = [
        'program credits.aleo;',
        '',
        'mapping account:',
        '    key as address.public;',
        '    value as u64.public;',
        '',
        'function transfer_public:',
        '    input r0 as address.public;',
        '    input r1 as u64.public;',
        '    output r2 as u64.public;',
        '',
        'finalize transfer_public:',
        '    input r0 as address.public;',
        '    input r1 as u64.public;',
      ].join('\n')

      const request = vi.fn().mockResolvedValue(programSource)
      const client = createPublicClient({ transport: custom({ request }) })
      const tools = aleoAgentTools({ client })

      const tool = tools.find((t) => t.name === 'aleo_describe_program')!
      const result = (await tool.handler({ program: 'credits.aleo' })) as any

      expect(result.program).toBe('credits.aleo')
      expect(result.functions).toHaveLength(1)
      expect(result.functions[0].name).toBe('transfer_public')
      expect(result.functions[0].hasFinalize).toBe(true)
      expect(result.functions[0].inputs).toHaveLength(2)
      expect(result.mappings).toHaveLength(1)
      expect(result.mappings[0].name).toBe('account')
      expect(result.mappings[0].keyType).toBe('address')
      expect(result.mappings[0].valueType).toBe('u64')
    })
  })

  describe('with wallet client only', () => {
    function createMockWallet() {
      const request = vi.fn()
      const account = {
        type: 'rpc' as const,
        address: 'aleo1sender',
        sign: vi.fn(),
        signMessage: vi.fn(),
      }
      const walletClient = createWalletClient({ account, transport: custom({ request }) })
      return { walletClient, request }
    }

    it('returns write-only tools', () => {
      const { walletClient } = createMockWallet()
      const tools = aleoAgentTools({ walletClient })

      const names = tools.map((t) => t.name)
      expect(names).toContain('aleo_execute')
      expect(names).toContain('aleo_transfer')
      expect(names).toContain('aleo_deploy')
      // No read tools
      expect(names).not.toContain('aleo_get_block_number')
      expect(names).not.toContain('aleo_get_balance')
    })

    it('aleo_execute handler calls writeContract and returns structured JSON', async () => {
      const { walletClient, request } = createMockWallet()
      request.mockResolvedValue('at1txid123')

      const tools = aleoAgentTools({ walletClient })
      const tool = tools.find((t) => t.name === 'aleo_execute')!

      const result = await tool.handler({
        program: 'token.aleo',
        function: 'mint',
        inputs: ['aleo1recipient', '100u64'],
        fee: 5000,
      })

      expect(result).toEqual({ transactionId: 'at1txid123' })
    })

    it('aleo_transfer handler calls transfer and returns structured JSON', async () => {
      const { walletClient, request } = createMockWallet()
      request.mockResolvedValue('at1transfer456')

      const tools = aleoAgentTools({ walletClient })
      const tool = tools.find((t) => t.name === 'aleo_transfer')!

      const result = await tool.handler({
        to: 'aleo1recipient',
        amount: 1000000,
      })

      expect(result).toEqual({ transactionId: 'at1transfer456' })
    })

    it('aleo_deploy handler calls deployContract and returns structured JSON', async () => {
      const { walletClient, request } = createMockWallet()
      request.mockResolvedValue('at1deploy789')

      const tools = aleoAgentTools({ walletClient })
      const tool = tools.find((t) => t.name === 'aleo_deploy')!

      const result = await tool.handler({
        program: 'program my_token.aleo;',
        fee: 10000,
      })

      expect(result).toEqual({ transactionId: 'at1deploy789' })
    })
  })

  describe('with both clients', () => {
    it('returns all tools', () => {
      const request = vi.fn()
      const client = createPublicClient({ transport: custom({ request }) })
      const account = {
        type: 'rpc' as const,
        address: 'aleo1sender',
        sign: vi.fn(),
        signMessage: vi.fn(),
      }
      const walletClient = createWalletClient({ account, transport: custom({ request }) })

      const tools = aleoAgentTools({ client, walletClient })
      const names = tools.map((t) => t.name)

      expect(names).toContain('aleo_get_block_number')
      expect(names).toContain('aleo_get_balance')
      expect(names).toContain('aleo_read_mapping')
      expect(names).toContain('aleo_get_program')
      expect(names).toContain('aleo_get_block')
      expect(names).toContain('aleo_get_transaction')
      expect(names).toContain('aleo_describe_program')
      expect(names).toContain('aleo_execute')
      expect(names).toContain('aleo_transfer')
      expect(names).toContain('aleo_deploy')
      expect(tools).toHaveLength(10)
    })
  })

  describe('with no clients', () => {
    it('returns empty tools array', () => {
      const tools = aleoAgentTools({})
      expect(tools).toEqual([])
    })
  })
})

describe('aleoAgentToolSchemas', () => {
  it('returns schemas without handlers when called with no args', () => {
    const schemas = aleoAgentToolSchemas()
    expect(schemas.length).toBeGreaterThan(0)

    for (const schema of schemas) {
      expect(schema.name).toBeTypeOf('string')
      expect(schema.description).toBeTypeOf('string')
      expect(schema.inputSchema).toBeTypeOf('object')
      expect(schema.inputSchema.type).toBe('object')
      expect(schema.inputSchema.properties).toBeTypeOf('object')
      // No handler property on schemas
      expect((schema as any).handler).toBeUndefined()
    }
  })

  it('includes all public and wallet schemas by default', () => {
    const schemas = aleoAgentToolSchemas()
    const names = schemas.map((s) => s.name)

    expect(names).toContain('aleo_get_block_number')
    expect(names).toContain('aleo_get_block')
    expect(names).toContain('aleo_get_transaction')
    expect(names).toContain('aleo_describe_program')
    expect(names).toContain('aleo_execute')
    expect(names).toContain('aleo_deploy')
    expect(names).toContain('aleo_transfer')
  })

  it('returns only public schemas when only client is provided', () => {
    const request = vi.fn()
    const client = createPublicClient({ transport: custom({ request }) })
    const schemas = aleoAgentToolSchemas({ client })
    const names = schemas.map((s) => s.name)

    expect(names).toContain('aleo_get_block_number')
    expect(names).not.toContain('aleo_execute')
  })
})

describe('createAgentTools', () => {
  it('returns AgentTool[] with schema and handler fields', () => {
    const request = vi.fn()
    const client = createPublicClient({ transport: custom({ request }) })
    const tools = createAgentTools({ client })

    for (const tool of tools) {
      expect(tool.schema).toBeTypeOf('object')
      expect(tool.schema.name).toBeTypeOf('string')
      expect(tool.schema.description).toBeTypeOf('string')
      expect(tool.schema.inputSchema.type).toBe('object')
      expect(tool.handler).toBeTypeOf('function')
    }
  })
})
