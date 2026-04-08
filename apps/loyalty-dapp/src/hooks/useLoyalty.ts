import { useState, useCallback } from 'react'
import { publicClient, LOYALTY_PROGRAM } from '../lib/aleo'
import type { WalletClient } from '@veil/core'

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
  redeemVoucher: (voucherType: string, cost: number) => Promise<void>
  refreshStats: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTier(points: number): Tier {
  if (points >= 1000) return 'Gold'
  if (points >= 100) return 'Silver'
  return 'Bronze'
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLoyalty(walletClient: WalletClient | undefined): UseLoyaltyReturn {
  const [card, setCard] = useState<LoyaltyCard | null>(null)
  const [stats, setStats] = useState<CardStats>({ totalCards: null, totalPoints: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastTxId, setLastTxId] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // Read from public mappings — no wallet needed
  // -------------------------------------------------------------------------
  const refreshStats = useCallback(async () => {
    try {
      // readContract reads a single mapping value
      const totalCards = await publicClient.readContract({
        program: LOYALTY_PROGRAM,
        mapping: 'total_cards',
        key: '0u8',
      })
      const totalPoints = await publicClient.readContract({
        program: LOYALTY_PROGRAM,
        mapping: 'total_points',
        key: '0u8',
      })
      setStats({
        totalCards: totalCards ?? '0',
        totalPoints: totalPoints ?? '0',
      })
    } catch {
      // Mappings may not exist yet — that's OK
      setStats({ totalCards: '0', totalPoints: '0' })
    }
  }, [])

  // -------------------------------------------------------------------------
  // Mint a new loyalty card (private record)
  // -------------------------------------------------------------------------
  const mintCard = useCallback(async () => {
    if (!walletClient) {
      setError('Connect wallet first')
      return
    }
    setLoading(true)
    setError(null)
    try {
      // writeContract calls the program function via the wallet
      const txId = await walletClient.writeContract({
        program: LOYALTY_PROGRAM,
        function: 'mint_card',
        inputs: ['1u64'],  // card_id
        fee: 0.5,
      })
      setLastTxId(txId)

      // Optimistically update local state
      setCard({ cardId: '1', points: 0, tier: 'Bronze' })
      await refreshStats()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mint card')
    } finally {
      setLoading(false)
    }
  }, [walletClient, refreshStats])

  // -------------------------------------------------------------------------
  // Add points to the card
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
        program: LOYALTY_PROGRAM,
        function: 'add_points',
        inputs: [`${amount}u64`],
        fee: 0.25,
      })
      setLastTxId(txId)

      // Optimistic update
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
  // Redeem a voucher
  // -------------------------------------------------------------------------
  const redeemVoucher = useCallback(async (voucherType: string, cost: number) => {
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
        program: LOYALTY_PROGRAM,
        function: 'redeem_voucher',
        inputs: [`${voucherType}`, `${cost}u64`],
        fee: 0.25,
      })
      setLastTxId(txId)

      // Optimistic update
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
