import { useAccount, useChainId, useWalletClient } from 'wagmi'

/** Read the connected EVM wallet + chain id. Null when not connected. */
export function useEthereumSigner() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { data: walletClient } = useWalletClient()
  if (!isConnected || !address || !walletClient) return null
  return { address, chainId, walletClient }
}
