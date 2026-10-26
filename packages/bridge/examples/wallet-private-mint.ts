import type { TransactionInput } from '@provablehq/veil-core'
import type { BridgePlan, WalletPreparedXReserveDeposit } from '@provablehq/aleo-bridge-sdk'

/**
 * Builds the wallet nonce request for a saved private USDCx deposit preparation.
 *
 * Passes public data only; the wallet derives the scalar during `private_mint`.
 * The bridge validates the hook, reviewed wrapper, and nonce arguments before
 * asking the wallet to sign. This helper performs no network or wallet calls.
 *
 * @param plan Private xReserve transfer whose Aleo recipient receives the record.
 * @param prepared Public instruction from the application's durably saved wallet preparation.
 * @returns Options for quote, execute, resume, or complete on the bridge client.
 * @example
 * const options = walletPrivateMintOptions(quote.plan, savedPreparation)
 * await bridge.complete({ progress, ...options })
 */
export function walletPrivateMintOptions(
  plan: BridgePlan,
  prepared: WalletPreparedXReserveDeposit,
): { walletPreparedDeposit: WalletPreparedXReserveDeposit; privateMintNonceInput: TransactionInput } {
  return {
    walletPreparedDeposit: prepared,
    privateMintNonceInput: {
      type: 'derived',
      algorithm: 'shielded-usdcx-secret-nonce',
      args: {
        commitment: { type: 'string', value: prepared.hookData.slice(4, 68) },
        recipient: { type: 'address', value: plan.recipient },
      },
    },
  }
}
