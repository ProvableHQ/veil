import { describe, expect, it } from 'vitest'
import { quote as quoteSolanaHyperlaneTransfer } from '../../src/protocols/hyperlane/solana.js'
import { BridgeError } from '../../src/errors/bridgeErrors.js'
import type { SolanaRpcClient } from '../../src/solana/rpc.js'
import type { SolanaClient } from '../../src/connections/solana.js'
import {
  EXPECTED_IGP_PAYMENT_LAMPORTS,
  NETWORK_FEE_LAMPORTS,
  SOLANA_ROUTE_ID,
  igpAccountData,
  registryWithRoute,
  transferFixture,
  transferPlan,
} from '../fixtures/solanaHyperlane.js'

const GAS_PAYMENT_RENT_LAMPORTS = 1_872_240n
const DISPATCHED_MESSAGE_RENT_LAMPORTS = 2_241_120n
const FEE_PAYER_RENT_LAMPORTS = 890_880n

function rpcReturning(accountData: Uint8Array | null): SolanaRpcClient {
  return {
    getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1n }),
    getBlockHeight: () => { throw new Error('not used by quoteSolanaHyperlaneTransfer') },
    getBalance: () => { throw new Error('not used by quoteSolanaHyperlaneTransfer') },
    getAccountData: async () => accountData,
    getFeeForMessage: async () => NETWORK_FEE_LAMPORTS,
    getMinimumBalanceForRentExemption: async (dataLength) => {
      if (dataLength === 141) return GAS_PAYMENT_RENT_LAMPORTS
      if (dataLength === 194) return DISPATCHED_MESSAGE_RENT_LAMPORTS
      return FEE_PAYER_RENT_LAMPORTS
    },
    getSignatureStatus: () => { throw new Error('not used by quoteSolanaHyperlaneTransfer') },
    getTransactionLogs: () => { throw new Error('not used by quoteSolanaHyperlaneTransfer') },
  }
}

function client(publicClient: SolanaRpcClient): SolanaClient {
  return { family: 'solana', publicClient: { ...publicClient, sendTransaction: async () => ({ signature: 'unused' }) } }
}

describe('quoteSolanaHyperlaneTransfer', () => {
  it('quotes amount, IGP payment, network fee, rent, and executable total', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const rpc = rpcReturning(igpAccountData())

    const quote = await quoteSolanaHyperlaneTransfer(registry, client(rpc), { plan })

    expect(quote.routeId).toBe(SOLANA_ROUTE_ID)
    expect(quote.amountLamports).toBe(BigInt(transferFixture.amountLamports))
    expect(quote.igpPaymentLamports).toBe(EXPECTED_IGP_PAYMENT_LAMPORTS)
    expect(quote.networkFeeLamports).toBe(NETWORK_FEE_LAMPORTS)
    expect(quote.rentLamports).toBe(
      GAS_PAYMENT_RENT_LAMPORTS + DISPATCHED_MESSAGE_RENT_LAMPORTS + FEE_PAYER_RENT_LAMPORTS,
    )
    expect(quote.totalLamports).toBe(
      BigInt(transferFixture.amountLamports)
      + EXPECTED_IGP_PAYMENT_LAMPORTS
      + NETWORK_FEE_LAMPORTS
      + GAS_PAYMENT_RENT_LAMPORTS
      + DISPATCHED_MESSAGE_RENT_LAMPORTS
      + FEE_PAYER_RENT_LAMPORTS,
    )
  })

  it('throws a BridgeError when the configured IGP account cannot be read', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const rpc = rpcReturning(null)

    await expect(quoteSolanaHyperlaneTransfer(registry, client(rpc), { plan })).rejects.toThrow(BridgeError)
  })

  it('propagates route validation failures without touching the network', async () => {
    const registry = registryWithRoute()
    const plan = { ...transferPlan(registry), protocol: 'xreserve' as const }
    const rpc = rpcReturning(igpAccountData())

    await expect(quoteSolanaHyperlaneTransfer(registry, client(rpc), { plan })).rejects.toThrow(BridgeError)
  })
})
