import type { BridgeReceipt } from './protocol.js'

/**
 * Reports live CCTP fees in six-decimal USDC atomic units.
 * @property amountAtomic Total USDC burned on the source chain.
 * @property amountOutAtomic USDC after the full approved fee ceiling when forwarding; otherwise after the estimated protocol fee.
 * @property protocolFeeAtomic Live protocol fee, rounded up to an atomic unit.
 * @property forwardingFeeAtomic Live medium-priority forwarding fee, or zero for manual minting.
 * @property maxFeeAtomic Caller-approved fee ceiling committed by the burn.
 * @property minFinalityThreshold Fast (1000) or Standard (2000) source finality requirement.
 * @property forwarding Whether Circle submits the destination mint.
 */
export type EvmCctpTransferQuote = {
  amountAtomic: bigint
  amountOutAtomic: bigint
  protocolFeeAtomic: bigint
  forwardingFeeAtomic: bigint
  maxFeeAtomic: bigint
  minFinalityThreshold: 1000 | 2000
  forwarding: boolean
}

/**
 * Captures a submitted CCTP transaction and its resumable lifecycle state.
 * @property transactionId Most recent source approval, burn, or destination mint hash.
 * @property receipt Public state suitable for checkpoint creation and polling.
 */
export type EvmCctpTransferExecution = {
  transactionId: string
  receipt: BridgeReceipt
}
