import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { VeilProvider } from '@veil/react'
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { clusterApiUrl } from '@solana/web3.js'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from './wagmi-config.js'

const queryClient = new QueryClient()

export function PrivateFunProviders({ children }: { children: ReactNode }) {
  const solanaEndpoint = useMemo(() => clusterApiUrl('mainnet-beta'), [])
  const solanaWallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  )

  return (
    <VeilProvider network="mainnet" programs={['credits.aleo']} autoConnect={false}>
      <ConnectionProvider endpoint={solanaEndpoint}>
        <WalletProvider wallets={solanaWallets} autoConnect>
          <WalletModalProvider>
            <WagmiProvider config={wagmiConfig}>
              <QueryClientProvider client={queryClient}>
                {children}
              </QueryClientProvider>
            </WagmiProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </VeilProvider>
  )
}
