import { useEffect, useRef, useState } from 'react'
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import { Network } from '@provablehq/aleo-types'

type Props = { onClose: () => void }

/**
 * Aleo wallet picker.
 *
 * The underlying adapter splits selection (`selectWallet`, sync void) from
 * connection (`connect`, async, reads the selected wallet from React state).
 * We can't `selectWallet → connect` in the same event handler — `connect`
 * captures the pre-update wallet ref and throws `WalletNotSelectedError`.
 *
 * Fix: set a `pending` state from the click handler, and fire connect from
 * a `useEffect` that runs on the *next* render (after React commits the
 * selectWallet update). `wallet.connect` in that effect's closure is the
 * fresh function bound to the newly-selected wallet.
 *
 * A ref guards against double-firing if the effect re-runs before
 * `wallet.connecting` flips to true.
 */
export function AleoConnectModal({ onClose }: Props) {
  const wallet = useWallet()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const firedRef = useRef(false)

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

  // Fire connect on the render *after* selectWallet committed.
  useEffect(() => {
    if (!pending) {
      firedRef.current = false
      return
    }
    if (firedRef.current) return
    firedRef.current = true

    const network = wallet.network ?? Network.MAINNET
    console.log('[AleoConnectModal] firing connect', { name: pending, network })
    wallet
      .connect(network)
      .then(() => console.log('[AleoConnectModal] connect resolved'))
      .catch((e: unknown) => {
        console.error('[AleoConnectModal] connect rejected', e)
        setError(e instanceof Error ? e.message : String(e))
        setPending(null)
        firedRef.current = false
      })
  }, [pending, wallet])

  function pick(name: string) {
    setError(null)
    wallet.selectWallet(name as Parameters<typeof wallet.selectWallet>[0])
    setPending(name)
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
