import type { Transaction } from './transaction.js'
import type { Network } from './wallet.js'

export type BuildTransactionOptions = {
  programName: string
  functionName: string
  inputs: string[]
  fee: bigint
  privateFee?: boolean | undefined
  feeRecord?: string | undefined
}

export type BuildDeploymentOptions = {
  /** Aleo program source (`program X.aleo; ...`). */
  program: string
  fee: bigint
  privateFee?: boolean | undefined
  feeRecord?: string | undefined
}

/**
 * SDK-backed adapter for wallet-side operations that need network binaries.
 *
 * Despite the name, this hosts more than transaction proving: it's the
 * single slot a local wallet client uses to reach a network-bound SDK. As
 * of today it carries proving (`buildTransaction`/`buildDeployment`),
 * decryption (`decrypt`), and SDK rebinding (`switchNetwork`).
 */
export type ProvingConfig = {
  mode: 'delegated' | 'local'
  url?: string | undefined
  apiKey?: string | undefined
  /** Build an execution transaction for a program function call. */
  buildTransaction?: (options: BuildTransactionOptions) => Promise<Transaction>
  /** Build a deployment transaction for an Aleo program. */
  buildDeployment?: (options: BuildDeploymentOptions) => Promise<Transaction>
  /** Decrypt a record ciphertext using the wallet's view key. */
  decrypt?: (
    cipherText: string,
    tpk?: string,
    programId?: string,
    functionName?: string,
    index?: number,
  ) => Promise<string>
  /**
   * Reload the SDK binaries for a different network. Implementations bound
   * to a specific SDK module (e.g. via @veil/provable) provide this so
   * `walletClient.switchChain` can rebind for a local account.
   */
  switchNetwork?: (network: Network) => Promise<void>
}
