import type { Transaction } from './transaction.js'

export type BuildTransactionOptions = {
  programName: string
  functionName: string
  inputs: string[]
  /** Priority fee in microcredits (1 credit = 1_000_000 microcredits) */
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

export type ExecuteOptions = {
  programName: string
  functionName: string
  inputs: string[]
  /** Priority fee in microcredits (1 credit = 1_000_000 microcredits) */
  fee: bigint
  privateFee?: boolean | undefined
  programSource?: string | undefined
  programImports?: Record<string, string> | undefined
}

export type RawSimulateResult = {
  outputs: string[]
}

export type RawExecuteResult = {
  transactionId: string
  outputs: string[]
}

/** Proving configuration — determines how transactions are built */
export type ProvingConfig = {
  mode: 'delegated' | 'local'
  url?: string | undefined
  apiKey?: string | undefined
  /** Optional override for custom proving implementations */
  buildTransaction?: (options: BuildTransactionOptions) => Promise<Transaction>
  /** Local execution without broadcasting — returns raw output strings */
  simulate?: (options: SimulateOptions) => Promise<RawSimulateResult>
  /** Build, broadcast, wait for confirmation, and return raw output strings */
  execute?: (options: ExecuteOptions) => Promise<RawExecuteResult>
}
