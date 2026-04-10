import type { LoyaltyCard as LoyaltyCardType, Tier } from '../hooks/useLoyalty'

interface LoyaltyCardListProps {
  cards: LoyaltyCardType[]
  selectedCard: LoyaltyCardType | null
  onSelectCard: (cardId: string) => void
  connected: boolean
}

const TIER_CONFIG: Record<Tier, { color: string; bg: string; next: string }> = {
  Bronze: { color: '#cd7f32', bg: 'linear-gradient(135deg, #cd7f32 0%, #8b5a2b 100%)', next: '1,000 pts for Silver' },
  Silver: { color: '#c0c0c0', bg: 'linear-gradient(135deg, #c0c0c0 0%, #808080 100%)', next: '10,000 pts for Gold' },
  Gold:   { color: '#ffd700', bg: 'linear-gradient(135deg, #ffd700 0%, #b8860b 100%)', next: 'Max tier reached' },
}

function CardView({ card, selected, onClick }: { card: LoyaltyCardType; selected: boolean; onClick: () => void }) {
  const tier = TIER_CONFIG[card.tier]

  return (
    <div
      className={`loyalty-card ${selected ? 'selected' : ''}`}
      style={{ background: tier.bg, cursor: 'pointer', opacity: selected ? 1 : 0.7 }}
      onClick={onClick}
    >
      {selected && <div className="card-selected-badge">Active</div>}
      <div className="card-header">
        <span className="card-label">LOYALTY CARD</span>
        <span className="card-id">#{card.cardId.slice(0, 8)}...</span>
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

export function LoyaltyCard({ cards, selectedCard, onSelectCard, connected }: LoyaltyCardListProps) {
  if (!connected) {
    return (
      <div className="loyalty-card empty">
        <p>Connect your wallet to view your loyalty cards</p>
      </div>
    )
  }

  if (cards.length === 0) {
    return (
      <div className="loyalty-card empty">
        <p>No loyalty cards found. Mint one to get started!</p>
      </div>
    )
  }

  return (
    <div className="loyalty-cards-list">
      <div className="cards-header">
        <span>Your Cards ({cards.length})</span>
      </div>
      <div className="cards-grid">
        {cards.map((card) => (
          <CardView
            key={card.cardId}
            card={card}
            selected={selectedCard?.cardId === card.cardId}
            onClick={() => onSelectCard(card.cardId)}
          />
        ))}
      </div>
    </div>
  )
}
