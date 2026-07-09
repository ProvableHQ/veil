/**
 * Example: Autonomous Agent with Local Proving
 *
 * This shows how an AI agent (like a Coinbase AgentKit action, LangChain tool,
 * or autonomous bot) would use veil with a local private key and proving.
 *
 * Key difference from the wallet adapter example:
 * - No wallet popup. No user approval. The agent holds the key.
 * - Proving happens locally (or via a delegated prover service).
 * - The agent uses structured tool interfaces, not raw SDK calls.
 *
 * This is the pattern for:
 * - Coinbase AgentKit Aleo actions
 * - LangChain/Vercel AI tool definitions
 * - Autonomous DeFi bots
 * - Backend services that interact with Aleo
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createPublicClient,
  createWalletClient,
  custom,
  getContract,
  parseProgram,
} from '@provablehq/veil-core'
import { aleoAgentTools, createAgentTools } from '@provablehq/veil-core/agent'

// ---------------------------------------------------------------------------
// Mock proving infrastructure
// ---------------------------------------------------------------------------

// In production, this would be:
//   import { privateKeyToAccount, createProvingConfig } from '@provablehq/veil-sdk'
//
// The provable package wraps @provablehq/sdk and handles:
// - Key derivation from private key
// - ZK proof generation via WASM snarkVM
// - Transaction building via ProgramManager
//
// Here we mock it to show the pattern without WASM dependencies.

function createLocalAccount() {
  return {
    type: 'local' as const,
    source: 'privateKey' as const,
    address: 'aleo1agent8k3mnz0v9sgqn2qwkrvfzlm9k3h0k5j6q7xzmrk0rqcwgpsx4ywzn',
    privateKey: 'APrivateKey1zkpAgent...',
    viewKey: 'AViewKey1Agent...',
    sign: vi.fn().mockResolvedValue(new Uint8Array([10, 20, 30])),
    signMessage: vi.fn().mockResolvedValue(new Uint8Array([10, 20, 30])),
  }
}

function createMockProvingConfig() {
  return {
    mode: 'delegated' as const,
    url: 'https://prover.example.com',
    buildTransaction: vi.fn().mockImplementation(async (options) => {
      // In production, this calls ProgramManager.buildExecutionTransaction()
      // which generates a ZK proof. Takes seconds, not milliseconds.
      console.log(`    [Prover] Building proof for ${options.programName}/${options.functionName}`)
      console.log(`    [Prover] Inputs: ${JSON.stringify(options.inputs)}`)
      console.log(`    [Prover] Proof generated, transaction built`)
      return {
        type: 'execute',
        id: 'at1proved_tx_' + Math.random().toString(36).substring(7),
        execution: {
          transitions: [{
            program: options.programName,
            function: options.functionName,
            inputs: options.inputs.map((i: string) => ({ type: 'public', id: 'inp_1', value: i })),
            outputs: [],
            tpk: 'tpk1...',
            tcm: 'tcm1...',
          }],
        },
        fee: { transition: { id: 'fee_1', program: 'credits.aleo', function: 'fee_public', inputs: [], outputs: [], tpk: 'tpk2...', tcm: 'tcm2...' }, globalStateRoot: 'sr1...', proof: 'proof1...' },
      }
    }),
  }
}

// Mock REST API
function createMockHttpRequest() {
  return vi.fn().mockImplementation(async ({ method, params }) => {
    switch (method) {
      case 'getLatestHeight': return 17500000
      case 'getBalance': return '50000000u64' // 50 credits
      case 'getMappingValue': {
        const p = params as Record<string, unknown>
        if (p?.mapping === 'account') return '50000000u64'
        if (p?.mapping === 'is_whitelisted') return 'true'
        return null
      }
      case 'getProgram': return `program private_swap.aleo;

mapping account:
    key as address.public;
    value as u64.public;

mapping is_whitelisted:
    key as address.public;
    value as boolean.public;

function swap_private:
    input r0 as address.private;
    input r1 as u64.private;
    input r2 as address.private;
    output r3 as u64.private;

finalize swap_private:
    input r0 as address.public;
    input r1 as u64.public;

function add_liquidity:
    input r0 as u64.public;
    input r1 as u64.public;

finalize add_liquidity:
    input r0 as address.public;
    input r1 as u64.public;
`
      case 'sendTransaction': return 'at1confirmed_abc123'
      default: return null
    }
  })
}

// ---------------------------------------------------------------------------
// Pattern 1: Agent using veil clients directly
// (like a backend service or autonomous bot)
// ---------------------------------------------------------------------------

describe('Example: Autonomous Agent with Local Proving', () => {
  let publicClient: ReturnType<typeof createPublicClient>
  let walletClient: ReturnType<typeof createWalletClient>
  let account: ReturnType<typeof createLocalAccount>
  let provingConfig: ReturnType<typeof createMockProvingConfig>

  beforeEach(() => {
    account = createLocalAccount()
    provingConfig = createMockProvingConfig()

    const transport = custom({ request: createMockHttpRequest() })

    // Agent creates clients with its own private key — no wallet involved.
    // The proving config tells it how to generate ZK proofs.
    publicClient = createPublicClient({ transport })

    walletClient = createWalletClient({
      account,
      transport,
      proving: provingConfig,
    })
  })

  it('agent reads chain state to make decisions', async () => {
    // Agent checks its balance before doing anything
    const balance = await publicClient.getBalance({
      address: account.address,
    })
    console.log('  Agent balance:', balance, 'microcredits')
    expect(balance).toBe(50000000n)

    // Agent checks if it's whitelisted for a private swap
    const whitelisted = await publicClient.readContract({
      program: 'private_swap.aleo',
      mapping: 'is_whitelisted',
      key: account.address,
    })
    console.log('  Whitelisted:', whitelisted)
    expect(whitelisted).toBe('true')
  })

  it('agent discovers a program before interacting with it', async () => {
    const source = await publicClient.getCode({ program: 'private_swap.aleo' })
    const abi = parseProgram(source)

    console.log('  Discovered program:', abi.id)
    console.log('  Functions:', abi.functions.map(f =>
      `${f.name}(${f.inputs.map(i => `${i.type}.${i.visibility}`).join(', ')})`
    ).join(', '))

    // Agent can reason about the program structure
    const swapFn = abi.functions.find(f => f.name === 'swap_private')!
    expect(swapFn.inputs.every(i => i.visibility === 'private')).toBe(true)
    console.log('  swap_private uses all private inputs — good for privacy')
  })

  it('agent executes a private swap — proves locally', async () => {
    // The agent calls writeContract just like the wallet adapter example.
    // But here, the local proving config kicks in:
    // 1. buildTransaction() generates a ZK proof (the expensive step)
    // 2. The proved transaction is broadcast via HTTP
    const txId = await walletClient.writeContract({
      program: 'private_swap.aleo',
      function: 'swap_private',
      inputs: [
        account.address,           // sender (private)
        '1000000u64',              // amount (private)
        'aleo1counterparty...',     // recipient (private)
      ],
    })

    console.log('  Swap tx:', txId)
    expect(txId).toBe('at1confirmed_abc123')

    // The proving config was called with the right parameters
    expect(provingConfig.buildTransaction).toHaveBeenCalledWith({
      programName: 'private_swap.aleo',
      functionName: 'swap_private',
      inputs: [account.address, '1000000u64', 'aleo1counterparty...'],
      privateFee: undefined,
      imports: undefined,
    })
  })

  it('agent uses getContract for typed interactions', async () => {
    const source = await publicClient.getCode({ program: 'private_swap.aleo' })
    const abi = parseProgram(source)

    const swap = getContract({
      program: 'private_swap.aleo',
      abi,
      client: { public: publicClient, wallet: walletClient },
    })

    // Read through contract — typed mapping access
    const balance = await swap.read.account({ key: account.address })
    console.log('  Contract balance:', balance)

    // Write through contract — typed function call
    const txId = await swap.write.add_liquidity({
      inputs: ['5000000u64', '5000000u64'],
    })
    console.log('  Add liquidity tx:', txId)
    expect(txId).toBe('at1confirmed_abc123')
  })
})

// ---------------------------------------------------------------------------
// Pattern 2: Agent using tool interface
// (like a Coinbase AgentKit action or LangChain tool)
// ---------------------------------------------------------------------------

describe('Example: AgentKit-style Tool Integration', () => {
  it('registers veil tools in an agent framework', async () => {
    const transport = custom({ request: createMockHttpRequest() })
    const publicClient = createPublicClient({ transport })

    const account = createLocalAccount()
    const walletClient = createWalletClient({
      account,
      transport,
      proving: createMockProvingConfig(),
    })

    // Get tool definitions — these are what you'd register with AgentKit,
    // LangChain, Vercel AI, or any tool-calling framework.
    const tools = aleoAgentTools({ client: publicClient, walletClient })

    console.log('  Available tools:')
    for (const tool of tools) {
      console.log(`    - ${tool.name}: ${tool.description.substring(0, 60)}...`)
    }

    expect(tools.length).toBeGreaterThan(5)

    // Each tool has a JSON schema that LLMs can read
    const describeTool = tools.find(t => t.name === 'aleo_describe_program')!
    expect(describeTool.inputSchema).toEqual({
      type: 'object',
      properties: {
        program: { type: 'string', description: expect.any(String) },
      },
      required: ['program'],
    })
  })

  it('simulates an agent conversation using tools', async () => {
    const transport = custom({ request: createMockHttpRequest() })
    const publicClient = createPublicClient({ transport })
    const tools = aleoAgentTools({ client: publicClient })

    // Agent: "What block is the Aleo chain on?"
    const heightTool = tools.find(t => t.name === 'aleo_get_block_number')!
    const heightResult = await heightTool.handler({})
    console.log('  Agent asks: "What block is Aleo on?"')
    console.log('  Tool returns:', JSON.stringify(heightResult))
    expect(heightResult).toHaveProperty('height')

    // Agent: "What can private_swap.aleo do?"
    const describeTool = tools.find(t => t.name === 'aleo_describe_program')!
    const describeResult = await describeTool.handler({ program: 'private_swap.aleo' }) as any
    console.log('\n  Agent asks: "What can private_swap.aleo do?"')
    console.log('  Tool returns:', JSON.stringify({
      program: describeResult.program,
      functions: describeResult.functions?.map((f: any) => f.name),
      mappings: describeResult.mappings?.map((m: any) => m.name),
    }))
    expect(describeResult.program).toBe('private_swap.aleo')

    // Agent: "What's this address's balance?"
    const balanceTool = tools.find(t => t.name === 'aleo_get_balance')!
    const balanceResult = await balanceTool.handler({ address: 'aleo1agent...' })
    console.log('\n  Agent asks: "What\'s the balance?"')
    console.log('  Tool returns:', JSON.stringify(balanceResult))
  })

  it('shows the AgentKit registration pattern', () => {
    // This is how you'd wire veil into Coinbase AgentKit:
    //
    //   import { CdpAgentkit } from '@coinbase/cdp-agentkit-core'
    //   import { aleoAgentTools } from '@provablehq/veil-core/agent'
    //
    //   const aleoTools = aleoAgentTools({ client: publicClient, walletClient })
    //
    //   // Register each tool as an AgentKit action
    //   for (const tool of aleoTools) {
    //     agentkit.registerAction({
    //       name: tool.name,
    //       description: tool.description,
    //       schema: tool.inputSchema,
    //       handler: tool.handler,
    //     })
    //   }
    //
    // That's it. The agent can now call Aleo tools alongside
    // existing EVM tools, Solana tools, etc.

    const transport = custom({ request: createMockHttpRequest() })
    const publicClient = createPublicClient({ transport })
    const tools = aleoAgentTools({ client: publicClient })

    // Verify each tool has the shape AgentKit expects
    for (const tool of tools) {
      expect(tool).toHaveProperty('name')
      expect(tool).toHaveProperty('description')
      expect(tool).toHaveProperty('inputSchema')
      expect(tool).toHaveProperty('handler')
      expect(typeof tool.name).toBe('string')
      expect(typeof tool.description).toBe('string')
      expect(typeof tool.handler).toBe('function')
      expect(tool.inputSchema).toHaveProperty('type', 'object')
    }

    console.log('  All', tools.length, 'tools match AgentKit action shape')
  })
})
