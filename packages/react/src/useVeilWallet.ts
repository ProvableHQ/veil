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
} from '@provablehq/veil-core'
import { fromWalletAdapter, type AleoWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'

const DEFAULT_API_URL = 'https://api.provable.com/v2'

/**
 * Options for {@link useVeilWallet}.
 *
 * @property rpcUrl Node endpoint both clients read through (and the wallet
 *   client falls back to). Defaults to the Provable API,
 *   `https://api.provable.com/v2`.
 * @property network Network for the HTTP transport. Defaults to the connected
 *   wallet's network, or `'mainnet'` before a wallet connects. Set it to pin
 *   the transport to one network regardless of the wallet.
 */
export interface UseVeilWalletConfig {
  rpcUrl?: string
  network?: 'mainnet' | 'testnet'
}

/**
 * Clients, connection state, and connection controls from {@link useVeilWallet}.
 *
 * @property publicClient Read-only client for chain queries. Usable with or
 *   without a connected wallet.
 * @property walletClient Write client that signs and submits through the
 *   connected wallet. `undefined` until a wallet connects — gate writes on it.
 * @property address The connected account's address, or `null` when disconnected.
 * @property connected True once a wallet session is established and
 *   `walletClient` is available.
 * @property connecting True while a connect is in flight — use it to disable
 *   the connect button.
 * @property connect Opens the wallet's approval flow on its current network.
 *   Pass a wallet name to select and connect in one step; otherwise the wallet
 *   chosen via `selectWallet` is connected.
 * @property disconnect Ends the wallet session; `walletClient` becomes
 *   `undefined` and `address` becomes `null`.
 * @property wallets Detected wallets with their install status, for building a
 *   wallet picker.
 * @property selectWallet Chooses which wallet a later `connect()` opens, by name.
 */
export interface UseVeilWalletReturn {
  publicClient: PublicClient
  walletClient: WalletClient | undefined
  address: string | null
  connected: boolean
  connecting: boolean
  connect: (walletName?: string) => Promise<void>
  disconnect: () => Promise<void>
  wallets: ReturnType<typeof useWallet>['wallets']
  selectWallet: (name: string) => void
}

/**
 * All-in-one hook for veil + Aleo wallet interaction.
 *
 * Returns a publicClient (always available) and a walletClient
 * (available after wallet connection). No manual adapter bridging needed.
 *
 * ```tsx
 * import { useVeilWallet } from '@provablehq/veil-aleo-react-hooks'
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
    if (!wallet.connected || !wallet.address || !wallet.network) return undefined

    const walletNetwork: Network = wallet.network === 'testnet' ? 'testnet' : 'mainnet'

    const adapter: AleoWalletAdapter = {
      account: { address: wallet.address },
      connected: wallet.connected,
      network: walletNetwork,
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
      requestTransactionHistory: (program) =>
        wallet.requestTransactionHistory(program) as Promise<TxHistoryResult>,
      algorithmsSupported: () => wallet.algorithmsSupported(),
    }

    const { account, transport: walletTransport } = fromWalletAdapter(adapter)

    return createWalletClient({
      account,
      transport: fallback([walletTransport, http(rpcUrl, { network })]),
    })
  }, [wallet.connected, wallet.address, wallet.network, rpcUrl, network])

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
