import { useMemo, type ComponentProps, type ReactNode } from 'react'
import { AleoWalletProvider } from '@provablehq/aleo-wallet-adaptor-react'
import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield'
import { LeoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-leo'
import { PuzzleWalletAdapter } from '@provablehq/aleo-wallet-adaptor-puzzle'
import { FoxWalletAdapter } from '@provablehq/aleo-wallet-adaptor-fox'
import { Network } from '@provablehq/aleo-types'
import { WalletDecryptPermission } from '@provablehq/aleo-wallet-standard'

export interface VeilProviderProps {
  children: ReactNode
  /** Network to connect to. Defaults to 'mainnet'. */
  network?: 'mainnet' | 'testnet'
  /** Auto-connect to previously used wallet. Defaults to true. */
  autoConnect?: boolean
  /** Decrypt permission level. Defaults to UponRequest. */
  decryptPermission?: WalletDecryptPermission
  /** Programs to register with the wallet for decrypt permissions. */
  programs?: string[]
  /** Override the default wallet list. If omitted, all known wallets are included. */
  wallets?: ComponentProps<typeof AleoWalletProvider>['wallets']
}

const networkMap = {
  mainnet: Network.MAINNET,
  testnet: Network.TESTNET,
} as const

/**
 * Batteries-included provider for veil + Aleo wallets.
 *
 * Wraps your app with wallet connection support. All known Aleo wallets
 * (Shield, Leo, Puzzle, Fox) are auto-configured.
 *
 * ```tsx
 * import { VeilProvider } from '@veil/react'
 *
 * <VeilProvider network="mainnet">
 *   <App />
 * </VeilProvider>
 * ```
 */
export function VeilProvider({
  children,
  network = 'mainnet',
  autoConnect = true,
  decryptPermission = WalletDecryptPermission.UponRequest,
  programs,
  wallets: walletsOverride,
}: VeilProviderProps) {
  const wallets = useMemo(
    () =>
      walletsOverride ?? [
        new ShieldWalletAdapter(),
        new LeoWalletAdapter(),
        new PuzzleWalletAdapter(),
        new FoxWalletAdapter(),
      ],
    [walletsOverride],
  )

  return (
    <AleoWalletProvider
      wallets={wallets}
      network={networkMap[network]}
      autoConnect={autoConnect}
      decryptPermission={decryptPermission}
      programs={programs}
    >
      {children}
    </AleoWalletProvider>
  )
}
