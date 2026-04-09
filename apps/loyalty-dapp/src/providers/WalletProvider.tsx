import { useMemo, type ReactNode } from 'react'
import { AleoWalletProvider } from '@provablehq/aleo-wallet-adaptor-react'
import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield'
import { LeoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-leo'
import { PuzzleWalletAdapter } from '@provablehq/aleo-wallet-adaptor-puzzle'
import { FoxWalletAdapter } from '@provablehq/aleo-wallet-adaptor-fox'
import { Network } from '@provablehq/aleo-types'
import { WalletDecryptPermission } from '@provablehq/aleo-wallet-standard'

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [
      new ShieldWalletAdapter(),
      new LeoWalletAdapter(),
      new PuzzleWalletAdapter(),
      new FoxWalletAdapter(),
    ],
    [],
  )

  return (
    <AleoWalletProvider
      wallets={wallets}
      network={Network.MAINNET}
      decryptPermission={WalletDecryptPermission.UponRequest}
      autoConnect
    >
      {children}
    </AleoWalletProvider>
  )
}
