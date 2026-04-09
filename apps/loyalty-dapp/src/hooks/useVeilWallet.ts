import { useMemo } from 'react'
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import { createAleoWalletClient } from '../lib/aleo'
import type { AleoWalletAdapter } from '@veil/wallet-adapter'
import type { WalletClient } from '@veil/core'

/**
 * Bridge between @provablehq/aleo-wallet-adaptor-react and veil.
 *
 * Takes the Provable useWallet() context and returns a veil WalletClient
 * that works with writeContract(), readContract(), transfer(), etc.
 */
export function useVeilWallet(): {
  connected: boolean
  connecting: boolean
  address: string | null
  walletClient: WalletClient | undefined
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  wallets: ReturnType<typeof useWallet>['wallets']
  selectWallet: (name: string) => void
} {
  const wallet = useWallet()

  // Bridge the Provable wallet context into our AleoWalletAdapter interface
  const walletClient = useMemo(() => {
    if (!wallet.connected || !wallet.address) return undefined

    // Create an adapter-shaped object from the React context
    const adapter: AleoWalletAdapter = {
      account: { address: wallet.address },
      connected: wallet.connected,
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
    }

    return createAleoWalletClient(adapter)
  }, [wallet.connected, wallet.address])

  return {
    connected: wallet.connected,
    connecting: wallet.connecting,
    address: wallet.address,
    walletClient,
    connect: () => wallet.connect(wallet.network!),
    disconnect: () => wallet.disconnect(),
    wallets: wallet.wallets,
    selectWallet: wallet.selectWallet as unknown as (name: string) => void,
  }
}
