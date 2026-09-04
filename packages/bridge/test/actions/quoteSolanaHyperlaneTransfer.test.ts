import { describe, expect, it } from 'vitest'
import { quoteSolanaHyperlaneTransfer } from '../../src/actions/quoteSolanaHyperlaneTransfer.js'
import { BridgeError } from '../../src/errors/bridgeErrors.js'
import type { SolanaRpcReader } from '../../src/solana/rpc.js'
import {
  EXPECTED_IGP_PAYMENT_LAMPORTS,
  NETWORK_FEE_LAMPORTS,
  SOLANA_ROUTE_ID,
  igpAccountData,
  registryWithRoute,
  transferFixture,
  transferPlan,
} from '../fixtures/solanaHyperlane.js'

function rpcReturning(accountData: Uint8Array | null): SolanaRpcReader {
  return {
    getLatestBlockhash: () => { throw new Error('not used by quoteSolanaHyperlaneTransfer') },
    getBalance: () => { throw new Error('not used by quoteSolanaHyperlaneTransfer') },
    getAccountData: async () => accountData,
    getSignatureStatus: () => { throw new Error('not used by quoteSolanaHyperlaneTransfer') },
    getTransactionLogs: () => { throw new Error('not used by quoteSolanaHyperlaneTransfer') },
  }
}

describe('quoteSolanaHyperlaneTransfer', () => {
  it('quotes amount, IGP payment, network fee, and total from the IGP oracle account', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const rpc = rpcReturning(igpAccountData())

    const quote = await quoteSolanaHyperlaneTransfer(registry, rpc, { plan })

    expect(quote.routeId).toBe(SOLANA_ROUTE_ID)
    expect(quote.amountLamports).toBe(BigInt(transferFixture.amountLamports))
    expect(quote.igpPaymentLamports).toBe(EXPECTED_IGP_PAYMENT_LAMPORTS)
    expect(quote.networkFeeLamports).toBe(NETWORK_FEE_LAMPORTS)
    expect(quote.totalLamports).toBe(
      BigInt(transferFixture.amountLamports) + EXPECTED_IGP_PAYMENT_LAMPORTS + NETWORK_FEE_LAMPORTS,
    )
  })

  it('throws a BridgeError when the configured IGP account cannot be read', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const rpc = rpcReturning(null)

    await expect(quoteSolanaHyperlaneTransfer(registry, rpc, { plan })).rejects.toThrow(BridgeError)
  })

  it('propagates route validation failures without touching the network', async () => {
    const registry = registryWithRoute()
    const plan = { ...transferPlan(registry), protocol: 'xreserve' as const }
    const rpc = rpcReturning(igpAccountData())

    await expect(quoteSolanaHyperlaneTransfer(registry, rpc, { plan })).rejects.toThrow(BridgeError)
  })
})
