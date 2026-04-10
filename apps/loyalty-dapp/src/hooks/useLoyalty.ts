import { useState, useCallback, useEffect } from 'react'
import type { WalletClient, PublicClient } from '@veil/react'

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
  /** Nonce uniquely identifies this record instance */
  nonce: string
  /** The raw record plaintext — needed as input for program calls */
  recordPlaintext: string
}

export interface CardStats {
  totalCards: string | null
  totalPoints: string | null
}

export interface RewardVoucher {
  voucherId: string
  rewardType: number
  amount: number
  used: boolean
  recordPlaintext: string
}

export interface UseLoyaltyReturn {
  cards: LoyaltyCard[]
  vouchers: RewardVoucher[]
  selectedCard: LoyaltyCard | null
  selectCard: (cardId: string) => void
  stats: CardStats
  loading: boolean
  txStatus: 'idle' | 'pending' | 'accepted' | 'failed'
  error: string | null
  lastTxId: string | null
  mintCard: () => Promise<void>
  addPoints: (amount: number) => Promise<void>
  redeemVoucher: (rewardType: number, cost: number) => Promise<void>
  refreshStats: () => Promise<void>
  refreshCards: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTier(points: number): Tier {
  if (points >= 10000) return 'Gold'
  if (points >= 1000) return 'Silver'
  return 'Bronze'
}

function parseCardFromRecord(record: {
  recordName: string
  spent: boolean
  recordPlaintext: string
}): LoyaltyCard | null {
  if (record.recordName !== 'LoyaltyCard' || record.spent) return null

  const plaintext = record.recordPlaintext
  const pointsMatch = plaintext.match(/points:\s*(\d+)u64/)
  const tierMatch = plaintext.match(/tier:\s*(\d+)u8/)
  const cardIdMatch = plaintext.match(/card_id:\s*(\d+)field/)

  const nonceMatch = plaintext.match(/_nonce:\s*(\d+)group/)
  const points = pointsMatch ? Number(pointsMatch[1]) : 0
  const tierNum = tierMatch ? Number(tierMatch[1]) : 0
  const tier: Tier = tierNum >= 2 ? 'Gold' : tierNum >= 1 ? 'Silver' : 'Bronze'

  return {
    cardId: cardIdMatch?.[1] ?? 'unknown',
    points,
    tier,
    nonce: nonceMatch?.[1] ?? '',
    recordPlaintext: plaintext,
  }
}

function parseVoucherFromRecord(record: {
  recordName: string
  spent: boolean
  recordPlaintext: string
}): RewardVoucher | null {
  if (record.recordName !== 'RewardVoucher' || record.spent) return null

  const plaintext = record.recordPlaintext
  const voucherIdMatch = plaintext.match(/voucher_id:\s*(\d+)field/)
  const rewardTypeMatch = plaintext.match(/reward_type:\s*(\d+)u8/)
  const amountMatch = plaintext.match(/amount:\s*(\d+)u64/)

  return {
    voucherId: voucherIdMatch?.[1] ?? 'unknown',
    rewardType: rewardTypeMatch ? Number(rewardTypeMatch[1]) : 0,
    amount: amountMatch ? Number(amountMatch[1]) : 0,
    used: false, // unspent records only
    recordPlaintext: plaintext,
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLoyalty(
  walletClient: WalletClient | undefined,
  publicClient: PublicClient,
  address: string | null,
): UseLoyaltyReturn {
  const [cards, setCards] = useState<LoyaltyCard[]>([])
  const [vouchers, setVouchers] = useState<RewardVoucher[]>([])
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [stats, setStats] = useState<CardStats>({ totalCards: null, totalPoints: null })
  const [loading, setLoading] = useState(false)
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'accepted' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastTxId, setLastTxId] = useState<string | null>(null)

  const selectedCard = cards.find((c) => c.cardId === selectedCardId) ?? cards[0] ?? null

  // -------------------------------------------------------------------------
  // Load all loyalty cards from the wallet's records
  // -------------------------------------------------------------------------
  const refreshCards = useCallback(async () => {
    if (!walletClient) return
    try {
      // Load LoyaltyCard records from loyalty_token.aleo
      const tokenRecords = await walletClient.requestRecords({ program: TOKEN_PROGRAM }) as Array<{
        recordName: string
        spent: boolean
        recordPlaintext: string
      }>

      const parsedCards = tokenRecords
        .map(parseCardFromRecord)
        .filter((c): c is LoyaltyCard => c !== null)

      setCards(parsedCards)

      if (!selectedCardId && parsedCards.length > 0) {
        setSelectedCardId(parsedCards[0].cardId)
      }

      // Load RewardVoucher records from loyalty_rewards.aleo
      const rewardsRecords = await walletClient.requestRecords({ program: REWARDS_PROGRAM }) as Array<{
        recordName: string
        spent: boolean
        recordPlaintext: string
      }>

      const parsedVouchers = rewardsRecords
        .map(parseVoucherFromRecord)
        .filter((v): v is RewardVoucher => v !== null)

      setVouchers(parsedVouchers)
    } catch (e) {
      console.warn('[veil] Failed to load records:', e)
    }
  }, [walletClient, selectedCardId])

  // Load cards when wallet connects
  useEffect(() => {
    if (walletClient) refreshCards()
  }, [walletClient])

  const selectCard = useCallback((cardId: string) => {
    setSelectedCardId(cardId)
  }, [])

  // -------------------------------------------------------------------------
  // Read from public mappings — no wallet needed
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
        totalCards: String(totalCards ?? '0').replace('u64', ''),
        totalPoints: String(totalPoints ?? '0').replace('u64', ''),
      })
    } catch {
      setStats({ totalCards: '0', totalPoints: '0' })
    }
  }, [publicClient])

  // -------------------------------------------------------------------------
  // Wait for a transaction to confirm, then refresh on-chain state
  // -------------------------------------------------------------------------
  const waitAndRefresh = useCallback(async (txId: string) => {
    if (!walletClient) return
    setLastTxId(txId)
    setTxStatus('pending')
    try {
      const maxAttempts = 60
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        try {
          const result = await walletClient.transactionStatus({ transactionId: txId.trim() }) as
            { status: string; transactionId: string } | string
          const status = typeof result === 'string' ? result : (result as any)?.status ?? ''
          if (status === 'Accepted' || status === 'Finalized' || status === 'Confirmed') {
            // Use the on-chain transaction ID (at1...) for display
            const onChainId = typeof result !== 'string' ? (result as any)?.transactionId : txId
            if (onChainId) setLastTxId(onChainId)
            setTxStatus('accepted')
            await refreshStats()
            // Records may take a few seconds to propagate.
            // Poll until we detect a new nonce (new record instance).
            const previousNonces = new Set(cards.map((c) => c.nonce))
            for (let j = 0; j < 10; j++) {
              await new Promise((r) => setTimeout(r, 3000))
              await refreshCards()
              const currentNonces = new Set(cards.map((c) => c.nonce))
              const hasNewRecord = [...currentNonces].some((n) => !previousNonces.has(n))
                || currentNonces.size !== previousNonces.size
              if (hasNewRecord) break
            }
            await refreshStats()
            setTimeout(() => setTxStatus('idle'), 3000)
            return
          }
          if (status === 'Failed' || status === 'Rejected') {
            setTxStatus('failed')
            setError(`Transaction failed: ${status}`)
            setTimeout(() => setTxStatus('idle'), 5000)
            return
          }
        } catch {
          // Status not available yet, keep polling
        }
      }
      // Timed out
      await refreshCards()
      await refreshStats()
      setTxStatus('idle')
    } catch {
      setTxStatus('idle')
    }
  }, [walletClient, refreshCards, refreshStats])

  // -------------------------------------------------------------------------
  // Mint a new loyalty card
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
      // Wait for on-chain confirmation, then refresh records + mappings
      waitAndRefresh(txId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mint card')
    } finally {
      setLoading(false)
    }
  }, [walletClient, address, refreshStats, refreshCards])

  // -------------------------------------------------------------------------
  // Add points to the selected card
  // -------------------------------------------------------------------------
  const addPoints = useCallback(async (amount: number) => {
    if (!walletClient) {
      setError('Connect wallet first')
      return
    }
    if (!selectedCard) {
      setError('No card selected')
      return
    }
    setLoading(true)
    setError(null)
    try {
      // Refresh records to ensure we have an unspent card
      await refreshCards()
      const freshCard = cards.find((c) => c.cardId === selectedCard.cardId && c.nonce)
        ?? cards.find((c) => !c.nonce || c.nonce) // fallback to any unspent card
      if (!freshCard) {
        setError('No unspent card available. Wait for pending transactions to confirm.')
        setLoading(false)
        return
      }
      // add_points takes (LoyaltyCard.record, u64)
      const txId = await walletClient.writeContract({
        program: TOKEN_PROGRAM,
        function: 'add_points',
        inputs: [freshCard.recordPlaintext, `${amount}u64`],
      })
      // Wait for on-chain confirmation, then refresh records + mappings
      waitAndRefresh(txId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add points')
    } finally {
      setLoading(false)
    }
  }, [walletClient, selectedCard, refreshStats])

  // -------------------------------------------------------------------------
  // Redeem points for a voucher
  // -------------------------------------------------------------------------
  const redeemVoucher = useCallback(async (rewardType: number, cost: number) => {
    if (!walletClient) {
      setError('Connect wallet first')
      return
    }
    if (!selectedCard) {
      setError('No card selected')
      return
    }
    if (selectedCard.points < cost) {
      setError(`Not enough points. Need ${cost}, have ${selectedCard.points}`)
      return
    }
    setLoading(true)
    setError(null)
    try {
      // Refresh records to ensure we have an unspent card
      await refreshCards()
      const freshCard = cards.find((c) => c.cardId === selectedCard.cardId && c.nonce)
        ?? cards.find((c) => !c.nonce || c.nonce)
      if (!freshCard) {
        setError('No unspent card available. Wait for pending transactions to confirm.')
        setLoading(false)
        return
      }
      // redeem_points_for_voucher takes (LoyaltyCard.record, u8, u64)
      const txId = await walletClient.writeContract({
        program: REWARDS_PROGRAM,
        function: 'redeem_points_for_voucher',
        inputs: [freshCard.recordPlaintext, `${rewardType}u8`, `${cost}u64`],
      })
      // Wait for on-chain confirmation, then refresh records + mappings
      waitAndRefresh(txId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to redeem voucher')
    } finally {
      setLoading(false)
    }
  }, [walletClient, selectedCard, refreshStats])

  return {
    cards,
    vouchers,
    selectedCard,
    selectCard,
    stats,
    txStatus,
    loading,
    error,
    lastTxId,
    mintCard,
    addPoints,
    redeemVoucher,
    refreshStats,
    refreshCards,
  }
}
