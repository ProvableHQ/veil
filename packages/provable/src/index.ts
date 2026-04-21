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
 *     transport: http('https://api.provable.com/v2'),
 *     proving: createProvingConfig({ mode: 'delegated', networkUrl: 'https://api.provable.com/v2' }),
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
  RecordScanner,
} from '@provablehq/sdk'
import type { LocalAccount } from '@veil/core'
import type { ProvingConfig, BuildTransactionOptions } from '@veil/core'
import type { OwnedRecord, RecordProvider, StandaloneRecordScanner, RequestRecordsParameters } from '@veil/core'
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

// ---------------------------------------------------------------------------
// Record scanner factories
// ---------------------------------------------------------------------------

function mapSdkRecords(records: any[], program: string, unspent: boolean): OwnedRecord[] {
  return records.map((record) => ({
    programName: record.program_name ?? program,
    tag: '',
    recordName: undefined,
    spent: !unspent,
    owner: record.owner,
    recordPlaintext: record.record_plaintext ?? '',
    recordCiphertext: record.record_ciphertext,
    transactionId: record.transaction_id,
    transitionId: record.transition_id,
  }))
}

/**
 * Creates a local record scanner backed by @provablehq/sdk's NetworkRecordProvider.
 *
 * Used with LocalWalletClientConfig. The scanner manages the active account
 * internally — setAccount() is called by createWalletClient on initialization
 * and can be called again on account switch.
 */
export function createLocalScanner(options: {
  /** Node URL to fetch encrypted records from */
  url: string
}): RecordProvider {
  let sdkAccount: InstanceType<typeof Account> | undefined

  return {
    setAccount: (account: { viewKey: string }) => {
      // Create a full SDK account for the NetworkRecordProvider
      // The SDK derives what it needs from the view key internally
      const viewKey = ViewKey.from_string(account.viewKey)
      sdkAccount = new Account({ viewKey: viewKey.to_string() })
    },

    requestRecords: async (params: RequestRecordsParameters): Promise<OwnedRecord[]> => {
      if (!sdkAccount) {
        throw new Error('No active account set on record scanner. Call setAccount() first.')
      }

      const networkClient = new AleoNetworkClient(options.url)
      const recordProvider = new NetworkRecordProvider(sdkAccount, networkClient)

      const unspent = params.statusFilter !== 'spent'
      const ownedRecords = await recordProvider.findRecords({
        unspent,
        programName: params.program,
      })

      return mapSdkRecords(ownedRecords, params.program, unspent)
    },
  }
}

/**
 * Creates a remote record scanner backed by Provable's RSS (Record Scanning Service).
 *
 * Used with LocalWalletClientConfig. Uses the SDK's RecordScanner class which
 * handles UUID derivation from the view key, registration, and record fetching.
 */
export function createRemoteScanner(options: {
  /** RSS endpoint URL */
  url: string
  /** Consumer ID for RSS authentication */
  consumerId: string
}): RecordProvider {
  let scanner: InstanceType<typeof RecordScanner> | undefined

  return {
    setAccount: (account: { viewKey: string }) => {
      const viewKey = ViewKey.from_string(account.viewKey)
      scanner = new RecordScanner({
        url: options.url,
        consumerId: options.consumerId,
        viewKeys: [viewKey],
        decryptEnabled: true,
        autoReRegister: true,
      })
    },

    requestRecords: async (params: RequestRecordsParameters): Promise<OwnedRecord[]> => {
      if (!scanner) {
        throw new Error('No active account set on record scanner. Call setAccount() first.')
      }

      const records = await scanner.owned({
        unspent: params.statusFilter !== 'spent',
        filter: {
          programs: [params.program],
        },
      })

      return (records ?? []) as OwnedRecord[]
    },
  }
}

/**
 * Creates a standalone record scanner with an explicit view key.
 *
 * For view-only use cases (dashboards, auditing) outside a wallet client.
 * NOT pluggable into a wallet client — use createLocalScanner or
 * createRemoteScanner for that.
 *
 * Can be used with the `withRecords` extension:
 * ```ts
 * const client = createPublicClient({ transport })
 *   .extend(withRecords({ scanner: createStandaloneScanner({ ... }) }))
 * ```
 */
export function createStandaloneScanner(options: {
  /** RSS endpoint URL */
  url: string
  /** Consumer ID for RSS authentication */
  consumerId: string
  /** View key for record scanning */
  viewKey: string
}): StandaloneRecordScanner {
  const viewKey = ViewKey.from_string(options.viewKey)
  const scanner = new RecordScanner({
    url: options.url,
    consumerId: options.consumerId,
    viewKeys: [viewKey],
    decryptEnabled: true,
    autoReRegister: true,
  })

  return {
    requestRecords: async (params: RequestRecordsParameters): Promise<OwnedRecord[]> => {
      const records = await scanner.owned({
        unspent: params.statusFilter !== 'spent',
        filter: {
          programs: [params.program],
        },
      })

      return (records ?? []) as OwnedRecord[]
    },
  }
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
 *   networkUrl: 'https://api.provable.com/v2',
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

  const publicClient = createPublicClient({ transport })

  const walletClient = createWalletClient({
    account,
    transport,
    proving,
  })

  return { publicClient, walletClient, account }
}
