import { useVeilWallet } from '@veil/react'

/** Read the connected Aleo wallet client + address, or null when disconnected. */
export function useAleoSigner() {
  const { walletClient, address } = useVeilWallet()
  if (!walletClient || !address) return null
  return { walletClient, address }
}
