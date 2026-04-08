/**
 * @veil/provable
 *
 * Wraps @provablehq/sdk to provide:
 * - privateKeyToAccount() with real key derivation and signing
 * - generateAccount() for new random accounts
 * - createProvingConfig() for plugging into WalletClient
 * - Record decryption and signature verification utilities
 *
 * Usage:
 *   import { privateKeyToAccount, createProvingConfig } from '@veil/provable'
 *   import { createWalletClient, createPublicClient, http } from '@veil/core'
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
  NetworkRecordProvider,
} from '@provablehq/sdk'
import type { LocalAccount } from '@veil/core'
import type { ProvingConfig, BuildTransactionOptions } from '@veil/core'
import type { RecordsConfig, RecordSearchParams, AleoRecord } from '@veil/core'
import {
  createPublicClient,
  createWalletClient,
  http,
} from '@veil/core'
import type { PublicClient, WalletClient } from '@veil/core'

/**
 * Creates a LocalAccount from an Aleo private key string.
 *
 * Uses @provablehq/sdk to derive address and view key automatically,
 * and provides real signing via the SDK's Account class.
 *
 * The sign() method returns the Signature serialized as a string encoded
 * to bytes. Use signMessage() for the same behavior. Both are compatible
 * with veil's SignerAccount interface.
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
  /** Account to use for proving — sets the signer on the ProgramManager */
  account?: LocalAccount<'privateKey'>
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

      // Bind the account so ProgramManager can sign transactions
      if (options.account) {
        const sdkAccount = new Account({ privateKey: options.account.privateKey })
        programManager.setAccount(sdkAccount)
      }

      const tx = await programManager.buildExecutionTransaction({
        programName: txOptions.programName,
        functionName: txOptions.functionName,
        priorityFee: Number(txOptions.fee),
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
 * Useful for direct SDK access when veil's transport layer isn't sufficient.
 */
export function createNetworkClient(url: string): AleoNetworkClient {
  return new AleoNetworkClient(url)
}

/**
 * Creates a RecordsConfig backed by @provablehq/sdk's NetworkRecordProvider.
 *
 * The returned config provides a `getRecords` function that scans the network
 * for records owned by the given account. This plugs directly into
 * createWalletClient({ records: ... }) or createPublicClient({ records: ... }).
 */
export function createRecordsConfig(options: {
  networkUrl: string
  account: LocalAccount<'privateKey'>
}): RecordsConfig {
  const sdkAccount = new Account({ privateKey: options.account.privateKey })
  const networkClient = new AleoNetworkClient(options.networkUrl)
  const recordProvider = new NetworkRecordProvider(sdkAccount, networkClient)

  return {
    getRecords: async (params: RecordSearchParams): Promise<AleoRecord[]> => {
      const ownedRecords = await recordProvider.findRecords({
        unspent: params.unspent ?? true,
        programName: params.program,
      })

      return ownedRecords.map((record) => ({
        owner: record.owner ?? '',
        data: record.record_plaintext
          ? parseRecordPlaintext(record.record_plaintext)
          : {},
        nonce: extractNonce(record.record_plaintext),
        programId: record.program_name ?? params.program,
        plaintext: record.record_plaintext ?? '',
      }))
    },
  }
}

/**
 * Parse an Aleo record plaintext string into a key-value data object.
 * Format: "{ key1: value1.private, key2: value2.public }"
 */
function parseRecordPlaintext(plaintext: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  // Strip outer braces and split on commas
  const inner = plaintext.replace(/^\{|\}$/g, '').trim()
  const pairs = inner.split(',')
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':')
    if (colonIdx === -1) continue
    const key = pair.slice(0, colonIdx).trim()
    const value = pair.slice(colonIdx + 1).trim()
    // Skip internal fields like _nonce and _version
    if (key.startsWith('_')) continue
    data[key] = value
  }
  return data
}

/**
 * Extract the nonce from an Aleo record plaintext string.
 */
function extractNonce(plaintext: string | undefined): string {
  if (!plaintext) return ''
  const match = plaintext.match(/_nonce:\s*(\S+)/)
  return match?.[1] ?? ''
}

/**
 * Creates a fully-wired Aleo client from just a private key and network URL.
 *
 * This is the "I just want it to work" entry point that sets up:
 * - A LocalAccount from the private key
 * - A PublicClient with HTTP transport
 * - A WalletClient with proving config and record scanning
 *
 * @example
 * ```ts
 * const { publicClient, walletClient, account } = createAleoClient({
 *   privateKey: 'APrivateKey1...',
 *   networkUrl: 'https://api.explorer.provable.com/v1',
 * })
 * ```
 */
export function createAleoClient(options: {
  privateKey: string
  networkUrl: string
  provingMode?: 'delegated' | 'local'
}): { publicClient: PublicClient; walletClient: WalletClient; account: LocalAccount<'privateKey'> } {
  const account = privateKeyToAccount(options.privateKey)
  const transport = http(options.networkUrl)

  const proving = createProvingConfig({
    mode: options.provingMode ?? 'delegated',
    networkUrl: options.networkUrl,
    account,
  })

  const records = createRecordsConfig({
    networkUrl: options.networkUrl,
    account,
  })

  const publicClient = createPublicClient({ transport })

  const walletClient = createWalletClient({
    account,
    transport,
    proving,
    records,
  })

  return { publicClient, walletClient, account }
}
