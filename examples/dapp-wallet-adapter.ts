/**
 * Example: Aleo dApp using a Wallet Adapter
 *
 * This shows how a frontend dApp would use veil with a browser wallet
 * (Leo Wallet, Puzzle, Fox, Shield). The wallet handles proving and signing —
 * the dApp just sends intents.
 *
 * In a real app, the wallet adapter comes from @provablehq/aleo-wallet-adaptor-leo
 * or similar. Here we mock it to show the pattern without a browser.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  fallback,
  getContract,
  parseProgram,
} from '@veil/core'
import {
  fromWalletAdapter,
  type AleoWalletAdapter,
} from '@veil/wallet-adapter'

// ---------------------------------------------------------------------------
// Mock wallet adapter — simulates a real browser wallet like Leo Wallet
// ---------------------------------------------------------------------------

function createMockLeoWallet(): AleoWalletAdapter {
  return {
    account: {
      address: 'aleo1user7qxz5drmf9vz5hn4dxrk3ws9k8gczqn0wpcafnj0mrc7g58q6zh0gn',
    },
    connected: true,
    network: 'mainnet',

    signMessage: vi.fn().mockImplementation(async (message: Uint8Array) => {
      // In a real wallet, this shows a popup asking the user to approve
      console.log('    [Leo Wallet] User approved message signing')
      return new Uint8Array([1, 2, 3, 4, 5]) // mock signature
    }),

    executeTransaction: vi.fn().mockImplementation(async (options) => {
      // In a real wallet, this:
      // 1. Shows a popup with the transaction details
      // 2. User approves
      // 3. Wallet generates the ZK proof internally
      // 4. Wallet broadcasts the proved transaction
      // 5. Returns the transaction ID
      console.log(`    [Leo Wallet] User approved: ${options.program}/${options.function}`)
      console.log(`    [Leo Wallet] Proving transaction... (wallet handles this)`)
      console.log(`    [Leo Wallet] Broadcasting...`)
      return { transactionId: 'at1wallet_tx_abc123' }
    }),

    executeDeployment: vi.fn().mockImplementation(async (deployment) => {
      console.log(`    [Leo Wallet] Deploying program: ${deployment.program.substring(0, 40)}...`)
      return { transactionId: 'at1wallet_deploy_xyz' }
    }),

    transactionStatus: vi.fn().mockResolvedValue({ status: 'accepted' }),
    decrypt: vi.fn().mockResolvedValue('{ owner: aleo1user..., amount: 1000u64 }'),
    // A privacy-preserving wallet returns a `uid` handle and only the granted
    // fields (`recordView`) — the record's full plaintext stays in the wallet.
    requestRecords: vi.fn().mockResolvedValue([
      {
        programName: 'credits.aleo',
        recordName: 'credits',
        spent: false,
        uid: 'uid_abc123',
        recordView: { fields: { microcredits: '500u64' } },
      },
    ]),
    transitionViewKeys: vi.fn().mockResolvedValue(['tvk1abc']),
    switchNetwork: vi.fn().mockResolvedValue(undefined),
    requestTransactionHistory: vi.fn().mockResolvedValue({ transactions: [] }),
    algorithmsSupported: vi.fn().mockResolvedValue([
      'program-scoped-blinding-factor',
      'program-scoped-blinded-address',
    ]),
  }
}

// Mock REST API responses for public reads
function createMockHttpRequest() {
  return vi.fn().mockImplementation(async ({ method, params }) => {
    switch (method) {
      case 'getLatestHeight': return 17500000
      case 'getBalance': return '25000000u64' // 25 credits
      case 'getMappingValue': return '1000000u64'
      case 'getProgram': return `program token.aleo;

mapping balances:
    key as address.public;
    value as u64.public;

mapping allowances:
    key as field.public;
    value as u64.public;

function transfer:
    input r0 as address.public;
    input r1 as u64.public;
    output r2 as u64.public;

finalize transfer:
    input r0 as address.public;
    input r1 as u64.public;

function approve:
    input r0 as address.public;
    input r1 as u64.public;
`
      default: return null
    }
  })
}

// ---------------------------------------------------------------------------
// The dApp
// ---------------------------------------------------------------------------

describe('Example dApp: Token Manager with Wallet Adapter', () => {
  let leoWallet: AleoWalletAdapter
  let publicClient: ReturnType<typeof createPublicClient>
  let walletClient: ReturnType<typeof createWalletClient>

  beforeEach(() => {
    // Step 1: User connects their Leo Wallet
    leoWallet = createMockLeoWallet()

    // Step 2: Create veil clients
    // The wallet adapter provides the account and a transport for writes.
    // HTTP transport handles reads (chain state queries).
    const { account, transport: walletTransport } = fromWalletAdapter(leoWallet)

    const httpTransport = custom({ request: createMockHttpRequest() })

    publicClient = createPublicClient({
      transport: httpTransport,
    })

    walletClient = createWalletClient({
      account,
      // Wallet transport handles writes, HTTP handles reads
      transport: fallback([walletTransport, httpTransport]),
    })
  })

  it('reads chain state without wallet involvement', async () => {
    // Public reads go straight to the REST API — no wallet popup
    const height = await publicClient.getBlockNumber()
    expect(height).toBe(17500000n)
    console.log('  Block height:', height)

    const balance = await publicClient.getBalance({
      address: 'aleo1user7qxz5drmf9vz5hn4dxrk3ws9k8gczqn0wpcafnj0mrc7g58q6zh0gn',
    })
    expect(balance).toBe(25000000n)
    console.log('  Balance:', balance, 'microcredits')
  })

  it('discovers a token program and creates a typed contract', async () => {
    // Fetch the program source and parse it
    const source = await publicClient.getCode({ program: 'token.aleo' })
    const abi = parseProgram(source)

    console.log('  Program:', abi.id)
    console.log('  Functions:', abi.functions.map(f => f.name).join(', '))
    console.log('  Mappings:', abi.mappings.map(m => m.name).join(', '))

    expect(abi.id).toBe('token.aleo')
    expect(abi.functions.map(f => f.name)).toContain('transfer')
    expect(abi.mappings.map(m => m.name)).toContain('balances')

    // Create a typed contract instance
    const token = getContract({
      program: 'token.aleo',
      abi,
      client: { public: publicClient, wallet: walletClient },
    })

    // Read through the contract — goes to HTTP, no wallet involved
    const tokenBalance = await token.read.balances({
      key: 'aleo1user7qxz5drmf9vz5hn4dxrk3ws9k8gczqn0wpcafnj0mrc7g58q6zh0gn',
    })
    console.log('  Token balance:', tokenBalance)

    // ABI validation — typos are caught
    expect(() => token.read.nonexistent({ key: 'test' })).toThrow('does not exist')
  })

  it('transfers tokens — wallet handles proving', async () => {
    // writeContract sends the intent to the wallet.
    // The wallet shows a popup, user approves, wallet proves + broadcasts.
    // We never touch a ZK proof or proving key.
    const txId = await walletClient.writeContract({
      program: 'token.aleo',
      function: 'transfer',
      inputs: ['aleo1recipient...', '500u64'],
    })

    expect(txId).toBe('at1wallet_tx_abc123')
    console.log('  Transfer tx:', txId)

    // The wallet adapter received the correct parameters
    expect(leoWallet.executeTransaction).toHaveBeenCalledWith({
      program: 'token.aleo',
      function: 'transfer',
      inputs: ['aleo1recipient...', '500u64'],
      privateFee: false,
    })
  })

  it('sends a convenience transfer of Aleo credits', async () => {
    // transfer() is sugar for writeContract on credits.aleo
    const txId = await walletClient.transfer({
      to: 'aleo1recipient...',
      amount: 1000000n, // 1 credit
    })

    expect(txId).toBe('at1wallet_tx_abc123')
    console.log('  Credits transfer tx:', txId)

    expect(leoWallet.executeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        program: 'credits.aleo',
        function: 'transfer_public',
      }),
    )
  })

  it('signs a message for authentication', async () => {
    // signMessage calls the wallet directly — not through the transport
    const sig = await walletClient.signMessage({
      message: new TextEncoder().encode('Login to MyDApp at 2026-04-02T00:00:00Z'),
    })

    expect(sig).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    console.log('  Signature:', sig)
  })

  it('decrypts a private record', async () => {
    // decrypt delegates to the wallet, which has the view key
    const plaintext = await walletClient.decrypt({
      ciphertext: 'record1ciphertext...',
      programId: 'credits.aleo',
    })

    expect(plaintext).toContain('amount')
    console.log('  Decrypted:', plaintext)
  })

  it('requests records from the wallet', async () => {
    const records = await walletClient.requestRecords({
      program: 'credits.aleo',
    })

    expect(records.length).toBeGreaterThan(0)
    console.log('  Records:', records.length, 'found')
  })

  it('composes a privacy-preserving transaction with wallet-fulfilled inputs', async () => {
    // 1. Read records. A privacy wallet returns a `uid` handle and only the
    //    granted fields — the plaintext never reaches the dApp.
    const records = (await walletClient.requestRecords({
      program: 'credits.aleo',
      statusFilter: 'unspent',
    })) as Array<{ uid?: string; recordView?: { fields: Record<string, string> } }>
    const rec = records[0]!
    console.log('  Record uid:', rec.uid, 'granted fields:', rec.recordView?.fields)

    // 2. Build a transfer whose inputs the WALLET fills in:
    //    - { type: 'record', uid } pins exactly this record (plaintext stays in the wallet)
    //    - { type: 'address' }     the wallet injects its own address; the dApp never sees it
    //    - '100u64'                an ordinary literal input
    const txId = await walletClient.writeContract({
      program: 'credits.aleo',
      function: 'transfer_private',
      inputs: [
        { type: 'record', program: 'credits.aleo', recordname: 'credits', uid: rec.uid! },
        { type: 'address' },
        '100u64',
      ],
    })
    expect(txId).toBe('at1wallet_tx_abc123')

    // The wallet adapter received the InputRequest objects unchanged — not stringified.
    const opts = (leoWallet.executeTransaction as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]
    expect(opts.inputs[0]).toEqual({ type: 'record', program: 'credits.aleo', recordname: 'credits', uid: 'uid_abc123' })
    expect(opts.inputs[1]).toEqual({ type: 'address' })
    expect(opts.inputs[2]).toBe('100u64')

    // Alternative: skip the read entirely and let the wallet auto-select by filters.
    await walletClient.writeContract({
      program: 'credits.aleo',
      function: 'transfer_private',
      inputs: [
        { type: 'record', program: 'credits.aleo', recordname: 'credits', filters: { microcredits: { gte: '100u64' } } },
        { type: 'address' },
        '100u64',
      ],
    })

    // Derived inputs (e.g. blinding values) are computed by the wallet from its
    // own private state; the dApp only declares which algorithms it expects.
    const algos = await leoWallet.algorithmsSupported()
    expect(algos).toContain('program-scoped-blinded-address')
    console.log('  Wallet supports derived algorithms:', algos.join(', '))
  })
})
