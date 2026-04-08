import { useEffect } from 'react'
import { useWallet } from './hooks/useWallet'
import { useLoyalty } from './hooks/useLoyalty'
import { WalletButton } from './components/WalletButton'
import { LoyaltyCard } from './components/LoyaltyCard'
import { Actions } from './components/Actions'
import { Stats } from './components/Stats'
import './app.css'

export function App() {
  const { connected, address, walletClient, connecting, connect, disconnect } = useWallet()
  const {
    card,
    stats,
    loading,
    error,
    lastTxId,
    mintCard,
    addPoints,
    redeemVoucher,
    refreshStats,
  } = useLoyalty(walletClient)

  // Load stats on mount
  useEffect(() => {
    refreshStats()
  }, [refreshStats])

  return (
    <div className="app">
      {/* Demo mode banner */}
      <div className="demo-banner">
        Demo Mode — using mock wallet adapter. In production, swap for LeoWalletAdapter / PuzzleWalletAdapter.
      </div>

      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="logo">Loyalty Points</h1>
          <span className="powered-by">powered by veil</span>
        </div>
        <WalletButton
          connected={connected}
          connecting={connecting}
          address={address}
          onConnect={connect}
          onDisconnect={disconnect}
        />
      </header>

      {/* Main content */}
      <main className="main">
        {/* Comparison callout */}
        <div className="comparison">
          <h2>The veil difference</h2>
          <div className="comparison-grid">
            <div className="comparison-card old">
              <h4>create-leo-app (before)</h4>
              <ul>
                <li>Web workers + Comlink</li>
                <li>Direct @provablehq/sdk imports</li>
                <li>Manual proving in the browser</li>
                <li>Complex worker lifecycle</li>
              </ul>
            </div>
            <div className="comparison-card new">
              <h4>veil (after)</h4>
              <ul>
                <li>writeContract() for executions</li>
                <li>readContract() for mapping reads</li>
                <li>Wallet handles proving</li>
                <li>~60 lines of chain integration</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="error-bar">
            {error}
          </div>
        )}

        {/* Card + Actions */}
        <div className="content-grid">
          <LoyaltyCard card={card} connected={connected} />
          <Actions
            connected={connected}
            hasCard={card !== null}
            loading={loading}
            onMint={mintCard}
            onAddPoints={addPoints}
            onRedeem={redeemVoucher}
          />
        </div>

        {/* Stats */}
        <Stats stats={stats} onRefresh={refreshStats} lastTxId={lastTxId} />
      </main>

      {/* Footer */}
      <footer className="footer">
        <a href="https://github.com/your-org/veil" target="_blank" rel="noopener">
          github.com/veil
        </a>
        <span className="sep">|</span>
        <span>No web workers. No SDK imports. Just viem-style calls.</span>
      </footer>
    </div>
  )
}
