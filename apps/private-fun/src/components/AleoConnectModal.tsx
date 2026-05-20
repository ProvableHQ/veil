import { useEffect, useState } from 'react'
import { useVeilWallet } from '@veil/react'

type Props = { onClose: () => void }

export function AleoConnectModal({ onClose }: Props) {
  const aleo = useVeilWallet()
  const [connecting, setConnecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose])

  // Close once the underlying wallet reports connected.
  useEffect(() => {
    if (aleo.connected) onClose()
  }, [aleo.connected, onClose])

  async function pick(name: string) {
    setError(null)
    setConnecting(name)
    try {
      await aleo.connect(name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setConnecting(null)
    }
  }

  return (
    <div className="pf-modal-backdrop" onClick={onClose}>
      <div className="pf-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>Connect Aleo wallet</h3>
        <div className="pf-modal-list">
          {aleo.wallets.map((w) => {
            const name = w.adapter.name
            const installed = String(w.readyState) === 'Installed'
            return (
              <button
                key={name}
                className="pf-modal-item"
                type="button"
                disabled={connecting !== null}
                onClick={() => pick(name)}
              >
                <span style={{ flex: 1 }}>{name}</span>
                <span style={{ color: installed ? 'var(--live)' : 'var(--muted)', fontSize: 11 }}>
                  {installed ? 'installed' : connecting === name ? 'connecting…' : 'not detected'}
                </span>
              </button>
            )
          })}
        </div>
        {error && <div className="pf-error">{error}</div>}
        <button className="pf-modal-close" type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
