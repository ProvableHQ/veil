import type { LoyaltyCard as LoyaltyCardType, Tier } from '../hooks/useLoyalty'

interface LoyaltyCardProps {
  card: LoyaltyCardType | null
  connected: boolean
}

const TIER_CONFIG: Record<Tier, { color: string; bg: string; next: string }> = {
  Bronze: { color: '#cd7f32', bg: 'linear-gradient(135deg, #cd7f32 0%, #8b5a2b 100%)', next: '100 pts for Silver' },
  Silver: { color: '#c0c0c0', bg: 'linear-gradient(135deg, #c0c0c0 0%, #808080 100%)', next: '1000 pts for Gold' },
  Gold:   { color: '#ffd700', bg: 'linear-gradient(135deg, #ffd700 0%, #b8860b 100%)', next: 'Max tier reached' },
}

export function LoyaltyCard({ card, connected }: LoyaltyCardProps) {
  if (!connected) {
    return (
      <div className="loyalty-card empty">
        <p>Connect your wallet to view your loyalty card</p>
      </div>
    )
  }

  if (!card) {
    return (
      <div className="loyalty-card empty">
        <p>No loyalty card found. Mint one to get started!</p>
      </div>
    )
  }

  const tier = TIER_CONFIG[card.tier]

  return (
    <div className="loyalty-card" style={{ background: tier.bg }}>
      <div className="card-header">
        <span className="card-label">LOYALTY CARD</span>
        <span className="card-id">#{card.cardId}</span>
      </div>
      <div className="card-points">
        <span className="points-value">{card.points.toLocaleString()}</span>
        <span className="points-label">POINTS</span>
      </div>
      <div className="card-footer">
        <span className="tier-badge" style={{ borderColor: tier.color }}>
          {card.tier}
        </span>
        <span className="tier-next">{tier.next}</span>
      </div>
    </div>
  )
}
