/**
 * Unified Interface: Same application code, different backends
 *
 * This example demonstrates veil's core design principle:
 * your application code stays IDENTICAL regardless of how the
 * user connects to Aleo. Only the client setup changes.
 *
 * Three backends are shown:
 *   A) Wallet adapter — browser wallet handles proving/signing
 *   B) Local account  — private key + local/delegated proving
 *   C) Custom service  — hypothetical third-party proving service
 *
 * All three use the same getBalance(), readContract(), writeContract(),
 * and getContract() calls. The transport mock responses are identical
 * because the point is the code pattern, not the network behavior.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createPublicClient,
  createWalletClient,
  custom,
  rpcAccount,
  getContract,
  parseProgram,
} from '@veil/core'
import type { PublicClient, WalletClient, Transport } from '@veil/core'

// ---------------------------------------------------------------------------
// Shared mock data — all backends return the same responses
// ---------------------------------------------------------------------------

const MOCK_ADDRESS = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'
const MOCK_BALANCE = '5000000u64' // 5 credits in microcredits
const MOCK_TX_ID = 'at1mock_transaction_id_0000000000000000000000000000000000000000000000'

/** Minimal credits.aleo source for parsing into an ABI */
const CREDITS_SOURCE = `program credits.aleo;

mapping account:
    key as address.public;
    value as u64.public;

function transfer_public:
    input r0 as address.public;
    input r1 as u64.public;

finalize transfer_public:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as u64.public;
`

/**
 * Creates a mock request handler that responds to veil's
 * internal RPC methods. This simulates the network layer.
 */
function createMockRequest() {
  return vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
    const p = params as Record<string, unknown> | undefined
    switch (method) {
      case 'getLatestHeight':
        return 20_000_000
      case 'getBalance':
        return MOCK_BALANCE
      case 'getMappingValue':
        return MOCK_BALANCE
      case 'getProgram':
        return CREDITS_SOURCE
      case 'executeTransaction':
        return MOCK_TX_ID
      case 'sendTransaction':
        return MOCK_TX_ID
      default:
        throw new Error(`Unhandled mock method: ${method}`)
    }
  })
}

// ---------------------------------------------------------------------------
// Backend A: Wallet Adapter
//
// In production, you'd use @veil/wallet-adapter's fromWalletAdapter()
// with a real browser wallet (Leo, Puzzle, Fox, etc). Here we simulate the
// same shape: an RPC account where the wallet handles signing/proving.
// ---------------------------------------------------------------------------

function setupWalletAdapterClient(): { publicClient: PublicClient; walletClient: WalletClient } {
  const mockRequest = createMockRequest()
  const transport = custom({ request: mockRequest })

  // The wallet adapter provides an RPC account — signing happens in the wallet
  const account = rpcAccount({
    address: MOCK_ADDRESS,
    sign: async (msg) => new Uint8Array([1, 2, 3]),
    signMessage: async (msg) => new Uint8Array([1, 2, 3]),
  })

  const publicClient = createPublicClient({ transport })
  const walletClient = createWalletClient({ account, transport })

  return { publicClient, walletClient }
}

// ---------------------------------------------------------------------------
// Backend B: Local Account (Provable SDK)
//
// In production, you'd use @veil/provable-sdk's privateKeyToAccount()
// and createProvingConfig(). Here we simulate a local account with
// a mock proving config.
// ---------------------------------------------------------------------------

function setupLocalAccountClient(): { publicClient: PublicClient; walletClient: WalletClient } {
  const mockRequest = createMockRequest()
  const transport = custom({ request: mockRequest })

  // A local account has a private key and proves transactions itself
  const account = {
    type: 'local' as const,
    source: 'privateKey' as const,
    address: MOCK_ADDRESS,
    privateKey: 'APrivateKey1mock',
    viewKey: 'AViewKey1mock',
    sign: async (msg: Uint8Array) => new Uint8Array([4, 5, 6]),
    signMessage: async (msg: Uint8Array) => new Uint8Array([4, 5, 6]),
  }

  // Proving config — in production this would be createProvingConfig()
  // from @veil/provable-sdk, using the SDK's ProgramManager
  const proving = {
    mode: 'delegated' as const,
    buildTransaction: async (opts: unknown) => ({ mockTx: true }),
  }

  const publicClient = createPublicClient({ transport })
  const walletClient = createWalletClient({ account, transport, proving })

  return { publicClient, walletClient }
}

// ---------------------------------------------------------------------------
// Backend C: Custom Service
//
// A hypothetical third-party service that handles proving and submission.
// This shows that veil is not locked to Provable SDK or any specific
// wallet — you can plug in any backend that speaks the transport protocol.
// ---------------------------------------------------------------------------

function setupCustomServiceClient(): { publicClient: PublicClient; walletClient: WalletClient } {
  const mockRequest = createMockRequest()
  const transport = custom({
    request: mockRequest,
    key: 'customService',
    name: 'Hypothetical Proving Service',
  })

  // Even a custom service uses the same account interface
  const account = rpcAccount({
    address: MOCK_ADDRESS,
    sign: async (msg) => new Uint8Array([7, 8, 9]),
    signMessage: async (msg) => new Uint8Array([7, 8, 9]),
  })

  const publicClient = createPublicClient({ transport })
  const walletClient = createWalletClient({ account, transport })

  return { publicClient, walletClient }
}

// ===========================================================================
// THE APPLICATION CODE — this is the part that stays IDENTICAL
// ===========================================================================

/**
 * This function represents your application logic. Notice it takes
 * PublicClient and WalletClient — it has NO idea which backend is
 * behind them. Wallet adapter? Local SDK? Custom service? Doesn't matter.
 */
async function applicationLogic(publicClient: PublicClient, walletClient: WalletClient) {
  // 1. Read the current block height
  const height = await publicClient.getBlockNumber()

  // 2. Check a balance
  const balance = await publicClient.getBalance({ address: MOCK_ADDRESS })

  // 3. Read a mapping value (same as getBalance under the hood for credits)
  const mappingValue = await publicClient.readContract({
    program: 'credits.aleo',
    mapping: 'account',
    key: MOCK_ADDRESS,
  })

  // 4. Execute a transfer — the proving/signing path differs per backend,
  //    but the application code is the same
  const txId = await walletClient.writeContract({
    program: 'credits.aleo',
    function: 'transfer_public',
    inputs: [MOCK_ADDRESS, '1000000u64'],
  })

  return { height, balance, mappingValue, txId }
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('Unified Interface: same code, different backends', () => {
  // Define the three backends
  const backends = [
    { name: 'Wallet Adapter (RPC account)', setup: setupWalletAdapterClient },
    { name: 'Local Account (Provable SDK)', setup: setupLocalAccountClient },
    { name: 'Custom Service (third-party)', setup: setupCustomServiceClient },
  ]

  for (const backend of backends) {
    describe(`Backend: ${backend.name}`, () => {
      it('runs the same application logic and produces the same results', async () => {
        // Setup differs per backend...
        const { publicClient, walletClient } = backend.setup()

        // ...but application logic is IDENTICAL
        const result = await applicationLogic(publicClient, walletClient)

        // All backends produce the same results
        expect(result.height).toBe(20_000_000n)
        expect(result.balance).toBe(5_000_000n)
        expect(result.mappingValue).toBe(MOCK_BALANCE)
        expect(result.txId).toBe(MOCK_TX_ID)
      })
    })
  }

  it('getContract() also works identically across backends', async () => {
    // Parse program source into an ABI (same for all backends)
    const abi = parseProgram(CREDITS_SOURCE)
    expect(abi.id).toBe('credits.aleo')
    expect(abi.mappings).toHaveLength(1)
    expect(abi.functions).toHaveLength(1)

    // Create contract instances with different backends
    for (const backend of backends) {
      const { publicClient, walletClient } = backend.setup()

      const credits = getContract({
        program: 'credits.aleo',
        abi,
        client: { public: publicClient, wallet: walletClient },
      })

      // Read through the contract instance
      const balance = await credits.read.account({ key: MOCK_ADDRESS })
      expect(balance).toBe(MOCK_BALANCE)

      // Write through the contract instance
      const txId = await credits.write.transfer_public({
        inputs: [MOCK_ADDRESS, '1000000u64'],
      })
      expect(txId).toBe(MOCK_TX_ID)
    }
  })

  it('demonstrates that only client setup differs — a side-by-side comparison', () => {
    // This test exists purely as documentation. The three setup functions
    // above show the ONLY code that changes between backends:
    //
    //   Wallet Adapter:
    //     const account = rpcAccount({ address, sign, signMessage })
    //     const walletClient = createWalletClient({ account, transport })
    //
    //   Local Account:
    //     const account = privateKeyToAccount('APrivateKey1...')
    //     const proving = createProvingConfig({ mode: 'delegated', ... })
    //     const walletClient = createWalletClient({ account, transport, proving })
    //
    //   Custom Service:
    //     const account = rpcAccount({ address, sign, signMessage })
    //     const transport = custom({ request: myServiceRequest })
    //     const walletClient = createWalletClient({ account, transport })
    //
    // After setup, ALL application code is identical:
    //     client.getBalance({ address })
    //     client.writeContract({ program, function, inputs, fee })
    //     getContract({ program, abi, client })
    //
    // This is the core value proposition of veil.
    expect(true).toBe(true)
  })
})
