export { VeilProvider, type VeilProviderProps } from './provider.js'
export { useVeilWallet, type UseVeilWalletReturn, type UseVeilWalletConfig } from './useVeilWallet.js'

// Re-export useful types so consumers don't need extra imports
export { type PublicClient, type WalletClient } from '@provablehq/veil-core'
export { type AleoWalletAdapter, type AnyWalletAdapter } from '@provablehq/veil-wallet-adapter'
