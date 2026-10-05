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

/**
 * Reads the Merkle tree used by a compliance-gated program's freezelist.
 *
 * Hits the configured Aleo network through the dApp's public client.
 *
 * @param programId Program that owns the compliance freezelist.
 * @returns The flat Merkle tree with its root as the final entry.
 * @example const tree = await getComplianceFreezeList('shield_swap_freezelist.aleo')
 */
export function getComplianceFreezeList(programId: string) {
  return publicClient.getFreezeList({ programId })
}

// ---------------------------------------------------------------------------
// Wallet client — created when a wallet connects
// ---------------------------------------------------------------------------
export function createAleoWalletClient(adapter: AleoWalletAdapter) {
  const { account, transport: walletTransport } = fromWalletAdapter(adapter)

  return createWalletClient({
    account,
    // Wallet transport handles executions; http handles reads as fallback
    transport: fallback([walletTransport, http(API_URL, { network: 'mainnet' })]),
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
