import { useState, useCallback } from 'react'
import { useVeilWallet, type WalletClient } from '@veil/react'

const TOKEN_PROGRAM = 'loyalty_token.aleo'
const REWARDS_PROGRAM = 'loyalty_rewards.aleo'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Tier = 'Bronze' | 'Silver' | 'Gold'

export interface LoyaltyCard {
  cardId: string
  points: number
  tier: Tier
}

export interface CardStats {
  totalCards: string | null
  totalPoints: string | null
}

export interface UseLoyaltyReturn {
  card: LoyaltyCard | null
  stats: CardStats
  loading: boolean
  error: string | null
  lastTxId: string | null
  mintCard: () => Promise<void>
  addPoints: (amount: number) => Promise<void>
  redeemVoucher: (rewardType: number, cost: number) => Promise<void>
  refreshStats: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTier(points: number): Tier {
  if (points >= 10000) return 'Gold'
  if (points >= 1000) return 'Silver'
  return 'Bronze'
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLoyalty(walletClient: WalletClient | undefined): UseLoyaltyReturn {
  const { publicClient, address } = useVeilWallet()
  const [card, setCard] = useState<LoyaltyCard | null>(null)
  const [stats, setStats] = useState<CardStats>({ totalCards: null, totalPoints: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastTxId, setLastTxId] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // Read from public mappings — no wallet needed
  // Mappings are on loyalty_token.aleo, keyed by 0field
  // -------------------------------------------------------------------------
  const refreshStats = useCallback(async () => {
    try {
      const totalCards = await publicClient.readContract({
        program: TOKEN_PROGRAM,
        mapping: 'total_cards',
        key: '0field',
      })
      const totalPoints = await publicClient.readContract({
        program: TOKEN_PROGRAM,
        mapping: 'total_points_issued',
        key: '0field',
      })
      setStats({
        totalCards: String(totalCards ?? '0'),
        totalPoints: String(totalPoints ?? '0'),
      })
    } catch {
      // Mappings may not exist yet — that's OK
      setStats({ totalCards: '0', totalPoints: '0' })
    }
  }, [publicClient])

  // -------------------------------------------------------------------------
  // Mint a new loyalty card (private record)
  // loyalty_token.aleo/mint_card(address, u64, field)
  //   - address: card owner
  //   - u64: initial points
  //   - field: nonce for unique card ID
  // -------------------------------------------------------------------------
  const mintCard = useCallback(async () => {
    if (!walletClient || !address) {
      setError('Connect wallet first')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const nonce = `${BigInt(Math.floor(Math.random() * 1e15))}field`
      const txId = await walletClient.writeContract({
        program: TOKEN_PROGRAM,
        function: 'mint_card',
        inputs: [address, '0u64', nonce],
      })
      setLastTxId(txId)
      setCard({ cardId: nonce, points: 0, tier: 'Bronze' })
      await refreshStats()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mint card')
    } finally {
      setLoading(false)
    }
  }, [walletClient, address, refreshStats])

  // -------------------------------------------------------------------------
  // Add points to the card
  // loyalty_token.aleo/add_points(LoyaltyCard.record, u64)
  //   - record: the user's loyalty card (wallet provides this)
  //   - u64: points to add
  // Note: requires a LoyaltyCard record input — the wallet must have one
  // -------------------------------------------------------------------------
  const addPoints = useCallback(async (amount: number) => {
    if (!walletClient) {
      setError('Connect wallet first')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const txId = await walletClient.writeContract({
        program: TOKEN_PROGRAM,
        function: 'add_points',
        inputs: [`${amount}u64`],
      })
      setLastTxId(txId)
      setCard((prev) => {
        if (!prev) return prev
        const newPoints = prev.points + amount
        return { ...prev, points: newPoints, tier: getTier(newPoints) }
      })
      await refreshStats()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add points')
    } finally {
      setLoading(false)
    }
  }, [walletClient, refreshStats])

  // -------------------------------------------------------------------------
  // Redeem points for a voucher
  // loyalty_rewards.aleo/redeem_points_for_voucher(LoyaltyCard.record, u8, u64)
  //   - record: the user's loyalty card
  //   - u8: reward type (1-3)
  //   - u64: points to spend (min 100)
  // -------------------------------------------------------------------------
  const redeemVoucher = useCallback(async (rewardType: number, cost: number) => {
    if (!walletClient) {
      setError('Connect wallet first')
      return
    }
    if (card && card.points < cost) {
      setError(`Not enough points. Need ${cost}, have ${card.points}`)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const txId = await walletClient.writeContract({
        program: REWARDS_PROGRAM,
        function: 'redeem_points_for_voucher',
        inputs: [`${rewardType}u8`, `${cost}u64`],
      })
      setLastTxId(txId)
      setCard((prev) => {
        if (!prev) return prev
        const newPoints = Math.max(0, prev.points - cost)
        return { ...prev, points: newPoints, tier: getTier(newPoints) }
      })
      await refreshStats()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to redeem voucher')
    } finally {
      setLoading(false)
    }
  }, [walletClient, card, refreshStats])

  return {
    card,
    stats,
    loading,
    error,
    lastTxId,
    mintCard,
    addPoints,
    redeemVoucher,
    refreshStats,
  }
}
