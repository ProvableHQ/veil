import type { BridgeFee, BridgePlan, BridgeReceipt } from './protocol.js'

/**
 * Reports the onchain fee and net public ALEO amount for Verulink.
 * Network fees remain unpriced until the wallets estimate their transactions.
 * @property kind Source transaction family.
 * @property protocol Verulink discriminator.
 * @property plan Validated transfer with the current net output.
 * @property routeId Reviewed directional route.
 * @property amountIn Gross decimal ALEO amount.
 * @property amountOut Net decimal ALEO amount.
 * @property amountAtomic Gross microcredits.
 * @property feeAtomic Truncated protocol fee in microcredits.
 * @property rate Onchain fee rate divided by 100,000.
 * @property fees Protocol charge and unpriced source/destination network fees.
 * @example const quote = await bridge.quote({ source: { chain: 'aleo', asset: 'aleo' }, destination: { chain: 'bsc', asset: 'aleo' }, amount: '20', recipient: bscAddress })
 */
export type VerulinkQuote = {
  kind: 'aleo-verulink' | 'evm-verulink'
  protocol: 'verulink'
  plan: BridgePlan
  routeId: string
  amountIn: string
  amountOut: string
  amountAtomic: bigint
  feeAtomic: bigint
  rate: bigint
  fees: BridgeFee[]
}

/**
 * Records a submitted Verulink source or claim transaction.
 * @property kind Chain family that submitted this transaction.
 * @property transactionId Submitted chain transaction identifier.
 * @property receipt Public state for status checks and checkpoint creation.
 * @example const execution = await bridge.execute({ plan: quote.plan, onCheckpoint: saveCheckpoint })
 */
export type VerulinkExecution = {
  kind: 'aleo-verulink' | 'evm-verulink'
  transactionId: string
  receipt: BridgeReceipt
}
