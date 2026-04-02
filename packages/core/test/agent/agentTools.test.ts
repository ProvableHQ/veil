import { describe, it, expect, vi } from 'vitest'
import { aleoAgentTools } from '../../src/agent/index.js'
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
      // No wallet tools
      expect(names).not.toContain('aleo_execute')
      expect(names).not.toContain('aleo_transfer')
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

      expect(result).toEqual({ balance: '5000000', unit: 'microcredits' })
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

      expect(result).toEqual({ value: '42u64' })
    })

    it('aleo_get_program handler calls getCode', async () => {
      const request = vi.fn().mockResolvedValue('program token.aleo;')
      const client = createPublicClient({ transport: custom({ request }) })
      const tools = aleoAgentTools({ client })

      const tool = tools.find((t) => t.name === 'aleo_get_program')!
      const result = await tool.handler({ program: 'token.aleo' })

      expect(result).toEqual({ source: 'program token.aleo;' })
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
      expect(names).toContain('aleo_execute')
      expect(names).toContain('aleo_transfer')
      expect(tools).toHaveLength(6)
    })
  })

  describe('with no clients', () => {
    it('returns empty tools array', () => {
      const tools = aleoAgentTools({})
      expect(tools).toEqual([])
    })
  })
})
