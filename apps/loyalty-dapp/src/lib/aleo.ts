/**
 * veil client setup for the loyalty dApp.
 *
 * This is the entire chain integration layer — compare to the original
 * create-leo-app template which needs web workers, Comlink, and direct
 * @provablehq/sdk imports.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  getContract,
  parseProgram,
} from '@provablehq/veil-core'
import { fromWalletAdapter, type AleoWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'

const API_URL = 'https://edge.provable.com/api/v2'

// ---------------------------------------------------------------------------
// Public client — always available, no wallet needed
// ---------------------------------------------------------------------------
export const publicClient = createPublicClient({
  transport: http(API_URL, { network: 'mainnet' }),
})

// ---------------------------------------------------------------------------
// Wallet client — created when a wallet connects
// ---------------------------------------------------------------------------
export function createAleoWalletClient(adapter: AleoWalletAdapter) {
  const { account, transport: walletTransport } = fromWalletAdapter(adapter)

  return createWalletClient({
    account,
    // Wallet transport handles executions; http handles reads as fallback
    transport: fallback([walletTransport, http(API_URL, { network: 'mainnet' })]),
    // Configure record planning without enabling reservations on wallet writes.
    // Managed private fees need a pinned fee record, which the current wallet
    // protocol cannot request. Local SDK signers support that selection.
    recordManagement: { enabled: false, chainId: 'aleo:mainnet' },
  })
}

// ---------------------------------------------------------------------------
// Loyalty program
// ---------------------------------------------------------------------------
export const LOYALTY_PROGRAM = 'loyalty_rewards.aleo'

/**
 * Create a typed contract instance for the loyalty program.
 *
 * With getContract + parseProgram, you get typed methods for every
 * function and mapping in the program — no manual ABI definition needed.
 */
export async function getLoyaltyContract(walletClient?: ReturnType<typeof createWalletClient>) {
  const source = await publicClient.getCode({ programId: LOYALTY_PROGRAM })
  const abi = parseProgram(source)

  return getContract({
    program: LOYALTY_PROGRAM,
    abi,
    client: walletClient
      ? { public: publicClient, wallet: walletClient }
      : publicClient,
  })
}

/**
 * Returns the connected wallet with its built-in inventory methods.
 * Planning requires wallet grants for record identities and amounts; coordination stays disabled.
 * @param walletClient Connected wallet client on Aleo mainnet.
 * @returns The same wallet client; the helper performs no scan or transaction.
 * @example
 * const inventory = createInventoryClient(createAleoWalletClient(adapter))
 * const plan = await inventory.planRecordInventory({
 *   asset: { program: 'credits.aleo' }, target: { records: 4 },
 * })
 */
export function createInventoryClient(walletClient: ReturnType<typeof createAleoWalletClient>) {
  return walletClient
}
