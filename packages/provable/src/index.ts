/**
 * @aleo-viem/provable
 *
 * Wraps @provablehq/sdk to provide:
 * - privateKeyToAccount() with automatic key derivation
 * - Local signing
 * - ProgramManager-based transaction building for local proving
 * - createProvingConfig() for plugging into WalletClient
 *
 * Usage:
 *   import { privateKeyToAccount, createProvingConfig } from '@aleo-viem/provable'
 *
 *   const account = await privateKeyToAccount('APrivateKey1...')
 *   const proving = createProvingConfig({ mode: 'delegated', url: 'https://...' })
 *
 *   const walletClient = createWalletClient({ account, transport: http(url), proving })
 */

// Re-export the SDK types we depend on so consumers don't need to import @provablehq/sdk directly
export type { Account as ProvableAccount } from '@provablehq/sdk'

import { Account, ProgramManager, AleoNetworkClient, AleoKeyProvider, NetworkRecordProvider } from '@provablehq/sdk'
import type { LocalAccount } from '@aleo-viem/core'
import type { ProvingConfig, BuildTransactionOptions } from '@aleo-viem/core'

/**
 * Creates a LocalAccount from an Aleo private key string.
 *
 * Uses @provablehq/sdk to derive address and view key automatically,
 * and provides real signing via the SDK's Account class.
 */
export function privateKeyToAccount(privateKey: string): LocalAccount<'privateKey'> {
  const sdkAccount = new Account({ privateKey })

  const address = sdkAccount.address().to_string()
  const viewKey = sdkAccount.viewKey().to_string()

  return {
    type: 'local',
    source: 'privateKey',
    address,
    privateKey,
    viewKey,
    sign: async (message: Uint8Array) => sdkAccount.sign(message),
    signMessage: async (message: Uint8Array) => sdkAccount.sign(message),
  }
}

/**
 * Creates a new random Aleo account.
 */
export function generateAccount(): LocalAccount<'privateKey'> {
  const sdkAccount = new Account()
  const privateKey = sdkAccount.privateKey().to_string()
  return privateKeyToAccount(privateKey)
}

/**
 * Creates a ProvingConfig that uses @provablehq/sdk's ProgramManager
 * for building transactions locally or via delegation.
 *
 * This plugs directly into createWalletClient({ proving: ... })
 */
export function createProvingConfig(options: {
  mode: 'delegated' | 'local'
  networkUrl: string
  /** Required for delegated proving — the prover service URL */
  proverUrl?: string
}): ProvingConfig {
  const networkClient = new AleoNetworkClient(options.networkUrl)
  const keyProvider = new AleoKeyProvider()
  keyProvider.useCache(true)

  return {
    mode: options.mode,
    url: options.proverUrl,

    buildTransaction: async (txOptions: BuildTransactionOptions) => {
      const programManager = new ProgramManager(options.networkUrl, keyProvider, undefined)

      const tx = await programManager.buildExecutionTransaction({
        programName: txOptions.programName,
        functionName: txOptions.functionName,
        fee: Number(txOptions.fee),
        privateFee: txOptions.privateFee ?? false,
        inputs: txOptions.inputs,
      })

      // Return the transaction in a format the http transport can broadcast
      return JSON.parse(tx.toString())
    },
  }
}

/**
 * Decrypts a record ciphertext using a view key from @provablehq/sdk.
 */
export function decryptRecord(viewKey: string, ciphertext: string): string {
  const account = Account.from_view_key(viewKey)
  return account.decryptRecord(ciphertext)
}

/**
 * Verifies a signature using @provablehq/sdk.
 */
export function verifySignature(address: string, message: Uint8Array, signature: Uint8Array): boolean {
  const account = Account.from_address(address)
  return account.verify(message, signature)
}
