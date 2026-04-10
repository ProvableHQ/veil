interface ActionsProps {
  connected: boolean
  hasCard: boolean
  loading: boolean
  onMint: () => void
  onAddPoints: (amount: number) => void
  onRedeem: (type: number, cost: number) => void
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
          </div>

          <div className="action-group">
            <h3>Redeem Vouchers</h3>
            <div className="action-row">
              <button
                className="action-btn redeem"
                onClick={() => onRedeem(1, 100)}
                disabled={loading}
              >
                Type 1 (100 pts)
              </button>
              <button
                className="action-btn redeem"
                onClick={() => onRedeem(2, 200)}
                disabled={loading}
              >
                Type 2 (200 pts)
              </button>
              <button
                className="action-btn redeem"
                onClick={() => onRedeem(3, 500)}
                disabled={loading}
              >
                Type 3 (500 pts)
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
