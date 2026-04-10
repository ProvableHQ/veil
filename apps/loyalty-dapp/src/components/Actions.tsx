interface ActionsProps {
  connected: boolean
  hasCard: boolean
  loading: boolean
  onMint: () => void
  onAddPoints: (amount: number) => void
  onRedeem: (type: string, cost: number) => void
}

export function Actions({ connected, hasCard, loading, onMint, onAddPoints, onRedeem }: ActionsProps) {
  if (!connected) {
    return null
  }

  return (
    <div className="actions">
      {!hasCard ? (
        <div className="action-group">
          <h3>Get Started</h3>
          <button className="action-btn mint" onClick={onMint} disabled={loading}>
            {loading ? 'Minting...' : 'Mint Loyalty Card'}
          </button>
          <CodeHint code={`walletClient.writeContract({
  program: 'loyalty_rewards.aleo',
  function: 'mint_card',
  inputs: ['1u64'],
  fee: 0.5,
})`} />
        </div>
      ) : (
        <>
          <div className="action-group">
            <h3>Earn Points</h3>
            <div className="action-row">
              {[10, 100, 1000].map((amount) => (
                <button
                  key={amount}
                  className="action-btn earn"
                  onClick={() => onAddPoints(amount)}
                  disabled={loading}
                >
                  +{amount}
                </button>
              ))}
            </div>
            <CodeHint code={`walletClient.writeContract({
  program: 'loyalty_rewards.aleo',
  function: 'add_points',
  inputs: ['100u64'],
  fee: 0.25,
})`} />
          </div>

          <div className="action-group">
            <h3>Redeem Vouchers</h3>
            <div className="action-row">
              <button
                className="action-btn redeem"
                onClick={() => onRedeem('coffee', 50)}
                disabled={loading}
              >
                Coffee (50 pts)
              </button>
              <button
                className="action-btn redeem"
                onClick={() => onRedeem('merch', 200)}
                disabled={loading}
              >
                Merch (200 pts)
              </button>
              <button
                className="action-btn redeem"
                onClick={() => onRedeem('vip', 500)}
                disabled={loading}
              >
                VIP Pass (500 pts)
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collapsible code hint — shows the veil call behind each action
// ---------------------------------------------------------------------------

function CodeHint({ code }: { code: string }) {
  return (
    <details className="code-hint">
      <summary>View veil code</summary>
      <pre><code>{code}</code></pre>
    </details>
  )
}
