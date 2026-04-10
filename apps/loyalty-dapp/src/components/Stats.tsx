import type { CardStats } from '../hooks/useLoyalty'

interface StatsProps {
  stats: CardStats
  onRefresh: () => void
  lastTxId: string | null
}

export function Stats({ stats, onRefresh, lastTxId }: StatsProps) {
  return (
    <div className="stats">
      <div className="stats-header">
        <h3>On-Chain Stats</h3>
        <button className="refresh-btn" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-value">{stats.totalCards ?? '--'}</span>
          <span className="stat-label">Total Cards Minted</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.totalPoints ?? '--'}</span>
          <span className="stat-label">Total Points Issued</span>
        </div>
      </div>

      <div className="code-hint" style={{ marginTop: '0.75rem' }}>
        <details>
          <summary>View veil code</summary>
          <pre><code>{`// No wallet needed — public reads
publicClient.readContract({
  program: 'loyalty_rewards.aleo',
  mapping: 'total_cards',
  key: '0u8',
})`}</code></pre>
        </details>
      </div>

      {lastTxId && (
        <div className="last-tx">
          Last tx: <span className="tx-id">{lastTxId.slice(0, 12)}...{lastTxId.slice(-6)}</span>
        </div>
      )}
    </div>
  )
}
