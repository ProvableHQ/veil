import { http, createConfig, type Config } from 'wagmi'
import { mainnet, base, arbitrum } from 'wagmi/chains'
import { injected, walletConnect, coinbaseWallet } from 'wagmi/connectors'

const WC_PROJECT_ID = import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID ?? ''

export const wagmiConfig: Config = createConfig({
  chains: [mainnet, base, arbitrum],
  connectors: [
    injected(),
    coinbaseWallet({ appName: 'private.fun' }),
    ...(WC_PROJECT_ID ? [walletConnect({ projectId: WC_PROJECT_ID })] : []),
  ],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
  },
})
