import { useWallet } from '@solana/wallet-adapter-react'

/** Read the connected Solana wallet + address. Null when not connected. */
export function useSolanaSigner() {
  const wallet = useWallet()
  if (!wallet.publicKey || !wallet.signTransaction) return null
  return {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction.bind(wallet),
    walletName: wallet.wallet?.adapter.name ?? null,
  }
}
