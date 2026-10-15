import { describe, it, expect, vi } from 'vitest'
import { createMcpServer } from '../../src/mcp/index.js'
import { createPublicClient } from '../../src/clients/createPublicClient.js'
import { createWalletClient } from '../../src/clients/createWalletClient.js'
import { custom } from '../../src/transports/custom.js'
import { freezelistProofRequest } from '../../src/utils/freezelistProof.js'

describe('createMcpServer', () => {
  it('preserves wallet proof and record inputs in MCP execution and private transfers', async () => {
    const request = vi.fn().mockResolvedValue('at1proof')
    const account = { type: 'rpc' as const, address: 'aleo1sender', sign: vi.fn(), signMessage: vi.fn() }
    const walletClient = createWalletClient({ account, transport: custom({ request }) })
    const server = createMcpServer({ walletClient })
    const proof = freezelistProofRequest({ freezelistProgram: 'compliance.aleo' })
    const record = { type: 'record', program: 'token.aleo', recordname: 'Token', uid: 'token-1' }
    const inputs = ['aleo1recipient', '100u128', record, proof]
    await server.handleToolCall('aleo_execute', { program: 'token.aleo', function: 'transfer_private', inputs })
    expect(request.mock.calls[0]![0].params.inputs).toEqual(inputs)
    await server.handleToolCall('aleo_transfer', { to: 'aleo1recipient', amount: '100', asset: 'token.aleo', amountWidth: 'u128', visibility: 'private', record, merkleProof: proof })
    expect(request.mock.calls[1]![0].params.inputs).toEqual(inputs)
  })

  it('rejects MCP wallet proof requests on a local account before proving', async () => {
    const buildTransaction = vi.fn()
    const request = vi.fn()
    const account = { type: 'local' as const, address: 'aleo1sender', sign: vi.fn(), signMessage: vi.fn() }
    const walletClient = createWalletClient({ account, proving: { buildTransaction } as any, transport: custom({ request }) })
    const server = createMcpServer({ walletClient })
    const proof = freezelistProofRequest({ freezelistProgram: 'compliance.aleo' })
    await expect(server.handleToolCall('aleo_execute', { program: 'token.aleo', function: 'prove', inputs: [proof] })).rejects.toThrow(/require a wallet account/)
    await expect(server.handleToolCall('aleo_transfer', { to: 'aleo1recipient', amount: 1, visibility: 'private', merkleProof: proof })).rejects.toThrow(/require a wallet account/)
    expect(buildTransaction).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })
  it('lists tools correctly with public client', () => {
    const request = vi.fn()
    const client = createPublicClient({ transport: custom({ request }) })
    const server = createMcpServer({ client })

    expect(server.tools.length).toBeGreaterThan(0)
    for (const tool of server.tools) {
      expect(tool.name).toBeTypeOf('string')
      expect(tool.description).toBeTypeOf('string')
      expect(tool.inputSchema).toBeTypeOf('object')
      // MCP tools should NOT have a handler property (stripped from agent tools)
      expect((tool as any).handler).toBeUndefined()
    }
  })

  it('lists tools correctly with both clients', () => {
    const request = vi.fn()
    const client = createPublicClient({ transport: custom({ request }) })
    const account = {
      type: 'rpc' as const,
      address: 'aleo1sender',
      sign: vi.fn(),
      signMessage: vi.fn(),
    }
    const walletClient = createWalletClient({ account, transport: custom({ request }) })
    const server = createMcpServer({ client, walletClient })

    const names = server.tools.map((t) => t.name)
    expect(names).toContain('aleo_get_block_number')
    expect(names).toContain('aleo_get_balance')
    expect(names).toContain('aleo_get_block')
    expect(names).toContain('aleo_get_transaction')
    expect(names).toContain('aleo_describe_program')
    expect(names).toContain('aleo_execute')
    expect(names).toContain('aleo_transfer')
    expect(names).toContain('aleo_deploy')
  })

  it('handleToolCall dispatches to the correct handler', async () => {
    const request = vi.fn().mockResolvedValue(99999)
    const client = createPublicClient({ transport: custom({ request }) })
    const server = createMcpServer({ client })

    const result = await server.handleToolCall('aleo_get_block_number', {})
    expect(result).toEqual({ height: '99999' })
  })

  it('handleToolCall dispatches aleo_get_balance correctly', async () => {
    const request = vi.fn().mockResolvedValue('5000000u64')
    const client = createPublicClient({ transport: custom({ request }) })
    const server = createMcpServer({ client })

    const result = await server.handleToolCall('aleo_get_balance', { address: 'aleo1test' })
    expect(result).toEqual({ balance: '5000000', unit: 'microcredits', address: 'aleo1test' })
  })

  it('handleToolCall dispatches aleo_get_block correctly', async () => {
    const mockBlock = { header: { height: 42 } }
    const request = vi.fn().mockResolvedValue(mockBlock)
    const client = createPublicClient({ transport: custom({ request }) })
    const server = createMcpServer({ client })

    const result = await server.handleToolCall('aleo_get_block', { height: 42 })
    expect(result).toEqual({ block: mockBlock })
  })

  it('handleToolCall dispatches aleo_get_transaction correctly', async () => {
    const mockTx = { id: 'at1abc' }
    const request = vi.fn().mockResolvedValue(mockTx)
    const client = createPublicClient({ transport: custom({ request }) })
    const server = createMcpServer({ client })

    const result = await server.handleToolCall('aleo_get_transaction', { id: 'at1abc' })
    expect(result).toEqual({ transaction: mockTx })
  })

  it('handleToolCall dispatches aleo_deploy correctly', async () => {
    const request = vi.fn().mockResolvedValue('at1deploy999')
    const account = {
      type: 'rpc' as const,
      address: 'aleo1sender',
      sign: vi.fn(),
      signMessage: vi.fn(),
    }
    const walletClient = createWalletClient({ account, transport: custom({ request }) })
    const server = createMcpServer({ walletClient })

    const result = await server.handleToolCall('aleo_deploy', {
      program: 'program test.aleo;',
      fee: 5000,
    })
    expect(result).toEqual({ transactionId: 'at1deploy999' })
  })

  it('handleToolCall throws helpful error for unknown tool', async () => {
    const request = vi.fn()
    const client = createPublicClient({ transport: custom({ request }) })
    const server = createMcpServer({ client })

    await expect(
      server.handleToolCall('nonexistent_tool', {}),
    ).rejects.toThrow('Unknown tool: "nonexistent_tool"')

    // Error message should include available tools
    try {
      await server.handleToolCall('nonexistent_tool', {})
    } catch (err: any) {
      expect(err.message).toContain('Available tools:')
      expect(err.message).toContain('aleo_get_block_number')
    }
  })

  it('returns empty tools with no clients', () => {
    const server = createMcpServer({})
    expect(server.tools).toEqual([])
  })
})
