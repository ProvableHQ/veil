export { VeilProvider, type VeilProviderProps } from './provider.js'
export { useVeilWallet, type UseVeilWalletReturn, type UseVeilWalletConfig } from './useVeilWallet.js'

// Re-export useful types so consumers don't need extra imports
export { type PublicClient, type WalletClient } from '@veil/core'
export { type AleoWalletAdapter, type AnyWalletAdapter } from '@veil/wallet-adapter'
