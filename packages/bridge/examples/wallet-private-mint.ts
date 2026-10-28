import type { TransactionInput } from '@provablehq/veil-core'
import type { BridgePlan, CircleOptions, WalletPreparedXReserveDeposit } from '@provablehq/aleo-bridge-sdk'

/**
 * Builds the Circle options for a saved private USDCx deposit preparation.
 *
 * Passes public data only; the wallet derives the scalar during `private_mint`.
 * The bridge validates the hook, reviewed wrapper, and nonce arguments before
 * asking the wallet to sign. This helper performs no network or wallet calls.
 *
 * @param plan Private xReserve transfer whose Aleo recipient receives the record.
 * @param prepared Public instruction from the application's durably saved wallet preparation.
 * @returns A `circle` option for quote, execute, resume, or complete on the bridge client.
 * @example
 * const options = walletPrivateMintOptions(quote.plan, savedPreparation)
 * await bridge.complete({ progress, ...options })
 */
export function walletPrivateMintOptions(
  plan: BridgePlan,
  prepared: WalletPreparedXReserveDeposit,
): { circle: Required<Pick<CircleOptions, 'walletPreparedDeposit' | 'privateMintNonceInput'>> } {
  const privateMintNonceInput: TransactionInput = {
    type: 'derived',
    algorithm: 'shielded-usdcx-secret-nonce',
    args: {
      commitment: { type: 'string', value: prepared.hookData.slice(4, 68) },
      recipient: { type: 'address', value: plan.recipient },
    },
  }
  return { circle: { walletPreparedDeposit: prepared, privateMintNonceInput } }
}
