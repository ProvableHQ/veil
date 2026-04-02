/**
 * @aleo-viem/provable
 *
 * Wraps @provablehq/sdk to provide:
 * - privateKeyToAccount() with real key derivation and signing
 * - generateAccount() for new random accounts
 * - createProvingConfig() for plugging into WalletClient
 * - Record decryption and signature verification utilities
 *
 * Usage:
 *   import { privateKeyToAccount, createProvingConfig } from '@aleo-viem/provable'
 *   import { createWalletClient, createPublicClient, http } from '@aleo-viem/core'
 *
 *   const account = privateKeyToAccount('APrivateKey1...')
 *   const walletClient = createWalletClient({
 *     account,
 *     transport: http('https://api.explorer.provable.com/v1'),
 *     proving: createProvingConfig({ mode: 'delegated', networkUrl: 'https://api.explorer.provable.com/v1' }),
 *   })
 */

import {
  Account,
  Signature,
  Address,
  ViewKey,
  ProgramManager,
  AleoNetworkClient,
  AleoKeyProvider,
} from '@provablehq/sdk'
import type { LocalAccount } from '@aleo-viem/core'
import type { ProvingConfig, BuildTransactionOptions } from '@aleo-viem/core'

/**
 * Creates a LocalAccount from an Aleo private key string.
 *
 * Uses @provablehq/sdk to derive address and view key automatically,
 * and provides real signing via the SDK's Account class.
 *
 * The sign() method returns the Signature serialized as a string encoded
 * to bytes. Use signMessage() for the same behavior. Both are compatible
 * with aleo-viem's SignerAccount interface.
 */
export function privateKeyToAccount(privateKey: string): LocalAccount<'privateKey'> {
  const sdkAccount = new Account({ privateKey })

  const address = sdkAccount.address().to_string()
  const viewKey = sdkAccount.viewKey().to_string()

  const signFn = async (message: Uint8Array): Promise<Uint8Array> => {
    const sig = sdkAccount.sign(message)
    // Serialize Signature to string, then to bytes for the interface
    return new TextEncoder().encode(sig.to_string())
  }

  return {
    type: 'local',
    source: 'privateKey',
    address,
    privateKey,
    viewKey,
    sign: signFn,
    signMessage: signFn,
  }
}

/**
 * Creates a new random Aleo account.
 * Returns a LocalAccount with a freshly generated private key.
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
  const keyProvider = new AleoKeyProvider()
  keyProvider.useCache(true)

  return {
    mode: options.mode,
    url: options.proverUrl,

    buildTransaction: async (txOptions: BuildTransactionOptions) => {
      const programManager = new ProgramManager(
        options.networkUrl,
        keyProvider,
        undefined,
      )

      const tx = await programManager.buildExecutionTransaction({
        programName: txOptions.programName,
        functionName: txOptions.functionName,
        fee: Number(txOptions.fee),
        privateFee: txOptions.privateFee ?? false,
        inputs: txOptions.inputs,
      })

      return JSON.parse(tx.toString())
    },
  }
}

/**
 * Decrypts a record ciphertext using a view key.
 */
export function decryptRecord(viewKeyString: string, ciphertext: string): string {
  const vk = ViewKey.from_string(viewKeyString)
  return vk.decrypt(ciphertext)
}

/**
 * Verifies a signature against a message and address.
 *
 * @param address - The Aleo address that allegedly signed the message
 * @param message - The original message bytes
 * @param signatureString - The signature as a string (sign1...)
 */
export function verifySignature(
  addressString: string,
  message: Uint8Array,
  signatureString: string,
): boolean {
  const sig = Signature.from_string(signatureString)
  const addr = Address.from_string(addressString)
  return sig.verify(addr, message)
}

/**
 * Creates an AleoNetworkClient from @provablehq/sdk.
 * Useful for direct SDK access when aleo-viem's transport layer isn't sufficient.
 */
export function createNetworkClient(url: string): AleoNetworkClient {
  return new AleoNetworkClient(url)
}
