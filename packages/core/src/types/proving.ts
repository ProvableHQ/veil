import type { Transaction } from './transaction.js'

export type BuildTransactionOptions = {
  programName: string
  functionName: string
  inputs: string[]
  fee: bigint
  privateFee?: boolean | undefined
  feeRecord?: string | undefined
}

/** Proving configuration — determines how transactions are built */
export type ProvingConfig = {
  mode: 'delegated' | 'local'
  url?: string | undefined
  apiKey?: string | undefined
  /** Optional override for custom proving implementations */
  buildTransaction?: (options: BuildTransactionOptions) => Promise<Transaction>
}

/**
 * Devnode configuration — builds transactions without ZK proof generation.
 * For use with a local Aleo Devnode, which does not verify proofs.
 */
export type DevnodeConfig = {
  buildTransaction: (options: BuildTransactionOptions) => Promise<Transaction>
}
