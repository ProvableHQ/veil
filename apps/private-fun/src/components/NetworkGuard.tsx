import type { ReactNode } from 'react'
import { useChainId, useSwitchChain } from 'wagmi'
import { CHAIN_CONFIGS, type ExternalChain } from '../lib/chains.js'

type Props = {
  requiredChain: ExternalChain
  children: ReactNode
}

/**
 * Blocks rendering until the connected EVM wallet is on the right chain. For
 * non-EVM chains (Solana) this is a no-op; cluster mismatch is surfaced inline
 * by individual pages if needed.
 */
export function NetworkGuard({ requiredChain, children }: Props) {
  const chainConfig = CHAIN_CONFIGS[requiredChain]
  const currentChainId = useChainId()
  const { switchChain, isPending } = useSwitchChain()

  if (chainConfig.evmChainId === null) return <>{children}</>

  if (currentChainId !== chainConfig.evmChainId) {
    return (
      <div className="pf-net-banner">
        <p>
          This action runs on <strong>{chainConfig.displayName}</strong>. Your wallet is on a different network.
        </p>
        <button
          className="pf-btn secondary"
          type="button"
          disabled={isPending}
          onClick={() => switchChain({ chainId: chainConfig.evmChainId! })}
        >
          {isPending ? 'Switching…' : `Switch to ${chainConfig.displayName}`}
        </button>
      </div>
    )
  }

  return <>{children}</>
}
