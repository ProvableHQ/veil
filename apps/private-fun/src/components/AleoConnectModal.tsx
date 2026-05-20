import { useEffect, useState } from 'react'
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import { Network } from '@provablehq/aleo-types'

type Props = { onClose: () => void }

/**
 * Aleo wallet picker.
 *
 * The underlying adapter splits selection (`selectWallet`) from connection
 * (`connect`), and the connect call requires React to have committed the
 * selection state first. We can't `selectWallet → connect` in the same tick
 * because `connect` reads from the pre-update wallet ref. Instead we mark
 * the selection as "pending" and let a useEffect fire the connect once the
 * adapter's selected-wallet name matches what we picked.
 */
export function AleoConnectModal({ onClose }: Props) {
  const wallet = useWallet()
  const [pending, setPending] = useState<string | null>(null)
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
    if (wallet.connected) onClose()
  }, [wallet.connected, onClose])

  // When the adapter's selected wallet catches up to our pending pick, fire connect.
  useEffect(() => {
    if (!pending) return
    if (wallet.connected) return
    if (wallet.connecting) return
    if (wallet.wallet?.adapter.name !== pending) return

    const network = wallet.network ?? Network.MAINNET
    wallet.connect(network).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e))
      setPending(null)
    })
  }, [
    pending,
    wallet.connected,
    wallet.connecting,
    wallet.wallet?.adapter.name,
    wallet.network,
    wallet,
  ])

  function pick(name: string) {
    setError(null)
    setPending(name)
    wallet.selectWallet(name as Parameters<typeof wallet.selectWallet>[0])
  }

  return (
    <div className="pf-modal-backdrop" onClick={onClose}>
      <div className="pf-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>Connect Aleo wallet</h3>
        <div className="pf-modal-list">
          {wallet.wallets.map((w) => {
            const name = w.adapter.name
            const installed = String(w.readyState) === 'Installed'
            const isPending = pending === name
            return (
              <button
                key={name}
                className="pf-modal-item"
                type="button"
                disabled={pending !== null && !isPending}
                onClick={() => pick(name)}
              >
                <span style={{ flex: 1 }}>{name}</span>
                <span style={{ color: installed ? 'var(--live)' : 'var(--muted)', fontSize: 11 }}>
                  {isPending
                    ? wallet.connecting
                      ? 'connecting…'
                      : 'selecting…'
                    : installed
                      ? 'installed'
                      : 'not detected'}
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
