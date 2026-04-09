import type { Transaction } from './transaction.js'

export type BuildTransactionOptions = {
  programName: string
  functionName: string
  inputs: string[]
  fee: bigint
  privateFee?: boolean | undefined
  feeRecord?: string | undefined
  programSource?: string | undefined
  programImports?: Record<string, string> | undefined
}

export type SimulateOptions = {
  programName: string
  functionName: string
  inputs: string[]
  programSource?: string | undefined
  programImports?: Record<string, string> | undefined
}

export type SimulateResult = {
  outputs: string[]
}

/** Proving configuration — determines how transactions are built */
export type ProvingConfig = {
  mode: 'delegated' | 'local'
  url?: string | undefined
  apiKey?: string | undefined
  /** Optional override for custom proving implementations */
  buildTransaction?: (options: BuildTransactionOptions) => Promise<Transaction>
  /** Local execution without broadcasting — returns outputs */
  simulate?: (options: SimulateOptions) => Promise<SimulateResult>
}
