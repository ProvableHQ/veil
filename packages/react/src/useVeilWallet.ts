import { useMemo } from 'react'
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  type Network,
  type PublicClient,
  type TxHistoryResult,
  type WalletClient,
} from '@veil/core'
import { fromWalletAdapter, type AleoWalletAdapter } from '@veil/wallet-adapter'

const DEFAULT_API_URL = 'https://api.provable.com/v2'

export interface UseVeilWalletConfig {
  /** RPC endpoint URL. Defaults to Provable mainnet API. */
  rpcUrl?: string
  /** Network for the HTTP transport. Defaults to 'mainnet'. */
  network?: 'mainnet' | 'testnet'
}

export interface UseVeilWalletReturn {
  /** Read-only client for chain queries. Always available. */
  publicClient: PublicClient
  /** Write client for transactions. Available when a wallet is connected. */
  walletClient: WalletClient | undefined
  /** Connected wallet address, or null. */
  address: string | null
  /** Whether a wallet is connected. */
  connected: boolean
  /** Whether a wallet is currently connecting. */
  connecting: boolean
  /** Connect a wallet. Pass a wallet name to select and connect in one step. */
  connect: (walletName?: string) => Promise<void>
  /** Disconnect the current wallet. */
  disconnect: () => Promise<void>
  /** Available wallets with their install status. */
  wallets: ReturnType<typeof useWallet>['wallets']
  /** Select a wallet by name before connecting. */
  selectWallet: (name: string) => void
}

/**
 * All-in-one hook for veil + Aleo wallet interaction.
 *
 * Returns a publicClient (always available) and a walletClient
 * (available after wallet connection). No manual adapter bridging needed.
 *
 * ```tsx
 * import { useVeilWallet } from '@veil/react'
 *
 * function App() {
 *   const { publicClient, walletClient, address, connect } = useVeilWallet()
 *
 *   // Read — always works
 *   const balance = await publicClient.getBalance({ address: 'aleo1...' })
 *
 *   // Write — after connect
 *   const txId = await walletClient.writeContract({
 *     program: 'my_program.aleo',
 *     function: 'transfer',
 *     inputs: ['aleo1...', '100u64'],
 *     fee: 500_000n,
 *   })
 * }
 * ```
 */
export function useVeilWallet(config?: UseVeilWalletConfig): UseVeilWalletReturn {
  const { rpcUrl = DEFAULT_API_URL } = config ?? {}

  const wallet = useWallet()

  // Derive network from the wallet provider context, with config override
  const network = config?.network ?? (wallet.network === 'testnet' ? 'testnet' : 'mainnet')

  const publicClient = useMemo(
    () => createPublicClient({ transport: http(rpcUrl, { network }) }),
    [rpcUrl, network],
  )

  const walletClient = useMemo(() => {
    if (!wallet.connected || !wallet.address) return undefined

    const adapter: AleoWalletAdapter & {
      switchNetwork?: (network: Network) => Promise<void>
      requestTransactionHistory?: (program: string) => Promise<TxHistoryResult>
      network?: Network | null
    } = {
      account: { address: wallet.address },
      connected: wallet.connected,
      network: wallet.network,
      signMessage: (message: Uint8Array) =>
        wallet.signMessage(message).then((r) => r ?? new Uint8Array()),
      executeTransaction: (options) =>
        wallet.executeTransaction(options).then((r) => r ?? { transactionId: '' }),
      executeDeployment: (deployment) => wallet.executeDeployment(deployment),
      transactionStatus: (txId) => wallet.transactionStatus(txId),
      decrypt: (cipherText) => wallet.decrypt(cipherText),
      requestRecords: (program, includePlaintext) =>
        wallet.requestRecords(program, includePlaintext),
      transitionViewKeys: (txId) => wallet.transitionViewKeys(txId),
      switchNetwork: async (network) => {
        await wallet.switchNetwork(network as any)
      },
      requestTransactionHistory: (program) => wallet.requestTransactionHistory(program),
    }

    const { account, transport: walletTransport } = fromWalletAdapter(adapter)

    return createWalletClient({
      account,
      transport: fallback([walletTransport, http(rpcUrl, { network })]),
    })
  }, [wallet.connected, wallet.address, rpcUrl, network])

  const connect = async (walletName?: string) => {
    if (walletName) {
      wallet.selectWallet(walletName as Parameters<typeof wallet.selectWallet>[0])
      // Allow React to process the selection before connecting
      await new Promise((r) => setTimeout(r, 0))
    }
    await wallet.connect(wallet.network!)
  }

  return {
    publicClient,
    walletClient,
    address: wallet.address,
    connected: wallet.connected,
    connecting: wallet.connecting,
    connect,
    disconnect: () => wallet.disconnect(),
    wallets: wallet.wallets,
    selectWallet: wallet.selectWallet as unknown as (name: string) => void,
  }
}
