import { useConnect } from 'wagmi'
import { useEffect } from 'react'

export function EthereumConnectModal({ onClose }: { onClose: () => void }) {
  const { connectors, connect, status, error } = useConnect()

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose])

  return (
    <div className="pf-modal-backdrop" onClick={onClose}>
      <div className="pf-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>Connect Ethereum wallet</h3>
        <div className="pf-modal-list">
          {connectors.map((connector) => (
            <button
              key={connector.uid}
              className="pf-modal-item"
              type="button"
              onClick={() => {
                connect({ connector })
                onClose()
              }}
            >
              {connector.name}
            </button>
          ))}
        </div>
        {status === 'error' && error && (
          <div className="pf-error">Error: {error.message}</div>
        )}
        <button className="pf-modal-close" type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
