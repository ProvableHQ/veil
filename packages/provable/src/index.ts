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
  NetworkRecordProvider,
  RecordScanner,
  RecordCiphertext,
  OfflineQuery,
} from '@provablehq/sdk'
import type { LocalAccount } from '@aleo-viem/core'
import type { ProvingConfig, BuildTransactionOptions, SimulateOptions, SimulateResult, ExecuteResult } from '@aleo-viem/core'
import type { RecordsConfig, RecordSearchParams, AleoRecord } from '@aleo-viem/core'
import {
  createPublicClient,
  createWalletClient,
  http,
} from '@aleo-viem/core'
import type { PublicClient, WalletClient } from '@aleo-viem/core'

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
  /** API key for delegated proving service */
  apiKey?: string
  /** Consumer ID for DPS/RSS authentication */
  consumerId?: string
  /** Enable TEE-encrypted proving */
  privacy?: boolean
  /** Account to use for proving — sets the signer on the ProgramManager */
  account?: LocalAccount<'privateKey'>
}): ProvingConfig {
  const keyProvider = new AleoKeyProvider()
  keyProvider.useCache(true)

  /** Create a configured ProgramManager instance */
  function makeProgramManager(): ProgramManager {
    const programManager = new ProgramManager(
      options.networkUrl,
      keyProvider,
      undefined,
    )
    if (options.account) {
      const sdkAccount = new Account({ privateKey: options.account.privateKey })
      programManager.setAccount(sdkAccount)
    }
    return programManager
  }

  return {
    mode: options.mode,
    url: options.proverUrl,
    apiKey: options.apiKey,

    buildTransaction: async (txOptions: BuildTransactionOptions) => {
      const programManager = makeProgramManager()

      if (options.mode === 'delegated' && options.proverUrl) {
        // Delegated: build proving request, submit to DPS, return tx
        const networkClient = new AleoNetworkClient(options.networkUrl)
        if (options.proverUrl) networkClient.setProverUri(options.proverUrl)

        const provingRequest = await programManager.provingRequest({
          programName: txOptions.programName,
          functionName: txOptions.functionName,
          priorityFee: Number(txOptions.fee),
          privateFee: txOptions.privateFee ?? false,
          inputs: txOptions.inputs,
          programSource: txOptions.programSource,
          programImports: txOptions.programImports,
          broadcast: true,
        })

        const response = await networkClient.submitProvingRequest({
          provingRequest,
          url: options.proverUrl,
          apiKey: options.apiKey,
          consumerId: options.consumerId,
        })

        return JSON.parse(JSON.stringify(response))
      }

      // Local: build execution transaction directly
      const tx = await programManager.buildExecutionTransaction({
        programName: txOptions.programName,
        functionName: txOptions.functionName,
        priorityFee: Number(txOptions.fee),
        privateFee: txOptions.privateFee ?? false,
        inputs: txOptions.inputs,
        program: txOptions.programSource,
        imports: txOptions.programImports,
      })

      return JSON.parse(tx.toString())
    },

    simulate: async (simOptions: SimulateOptions): Promise<SimulateResult> => {
      const programManager = makeProgramManager()

      // Build imports map if provided
      const imports: Record<string, string> | undefined = simOptions.programImports

      const executionResponse = await programManager.run(
        simOptions.programSource ?? simOptions.programName,
        simOptions.functionName,
        simOptions.inputs,
        false, // proveExecution
        imports,
        undefined, // keySearchParams
        undefined, // provingKey
        undefined, // verifyingKey
        undefined, // privateKey
        new OfflineQuery(0, 'sr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gk0xu'),
      )

      return { outputs: executionResponse.getOutputs() }
    },

    execute: async (txOptions: BuildTransactionOptions): Promise<ExecuteResult> => {
      const programManager = makeProgramManager()

      if (options.mode === 'delegated' && options.proverUrl) {
        // Delegated: build proving request, submit to DPS, wait for confirmation, extract outputs
        const networkClient = new AleoNetworkClient(options.networkUrl)
        if (options.proverUrl) networkClient.setProverUri(options.proverUrl)

        const provingRequest = await programManager.provingRequest({
          programName: txOptions.programName,
          functionName: txOptions.functionName,
          priorityFee: Number(txOptions.fee),
          privateFee: txOptions.privateFee ?? false,
          inputs: txOptions.inputs,
          programSource: txOptions.programSource,
          programImports: txOptions.programImports,
          broadcast: true,
        })

        const response = await networkClient.submitProvingRequest({
          provingRequest,
          url: options.proverUrl,
          apiKey: options.apiKey,
          consumerId: options.consumerId,
        })

        // Extract transaction ID from DPS response
        const txId = (response as any)?.transaction?.id ?? (response as any)?.id
        if (!txId) {
          throw new Error('DPS response did not contain a transaction ID')
        }

        // Wait for confirmation and extract outputs
        const explorerClient = new AleoNetworkClient('https://api.explorer.provable.com/v1')
        const confirmedTx = await waitForTransaction(explorerClient, txId)
        const outputs = extractOutputs(confirmedTx, options.account)

        return { transactionId: txId, outputs }
      }

      // Local mode: simulate locally (same as simulate, but matches the execute interface)
      const imports: Record<string, string> | undefined = txOptions.programImports

      const executionResponse = await programManager.run(
        txOptions.programSource ?? txOptions.programName,
        txOptions.functionName,
        txOptions.inputs,
        false,
        imports,
        undefined, undefined, undefined, undefined,
        new OfflineQuery(0, 'sr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gk0xu'),
      )

      return { transactionId: '', outputs: executionResponse.getOutputs() }
    },
  }
}

/** Poll explorer API until transaction is confirmed */
async function waitForTransaction(
  client: AleoNetworkClient,
  txId: string,
  timeoutMs = 300_000,
  pollIntervalMs = 5_000,
): Promise<any> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const tx = await client.getTransaction(txId)
      if (tx) return tx
    } catch {
      // Not found yet
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }
  throw new Error(`Transaction ${txId} not confirmed within ${timeoutMs / 1000}s`)
}

/** Extract and decrypt output records from a confirmed transaction */
function extractOutputs(
  transaction: any,
  account?: LocalAccount<'privateKey'>,
): string[] {
  const outputs: string[] = []
  if (!transaction?.execution?.transitions) return outputs

  for (const transition of transaction.execution.transitions) {
    if (!transition.outputs) continue
    for (const output of transition.outputs) {
      if (!output.value) continue
      if (output.type === 'record' && output.value.startsWith('record1') && account) {
        // Decrypt record ciphertext
        try {
          const ciphertext = RecordCiphertext.fromString(output.value)
          const sdkAccount = new Account({ privateKey: account.privateKey })
          if (ciphertext.isOwner(sdkAccount.viewKey())) {
            const plaintext = ciphertext.decrypt(sdkAccount.viewKey())
            outputs.push(plaintext.toString())
          }
        } catch {
          // Not our record or decryption failed — skip
        }
      } else {
        outputs.push(output.value)
      }
    }
  }

  return outputs
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

// ── Record Scanner ────────────────────────────────────────────────────

export type RecordScannerConfig = {
  /** Record scanning service URL (e.g. "https://api.provable.com/scanner") */
  url: string
  /** Account to scan for — view key is used for registration and decryption */
  account: LocalAccount<'privateKey'>
  /** API key for DPS authentication (used to fetch JWT if consumerId is also set) */
  apiKey?: string
  /** Consumer ID for automatic JWT fetching */
  consumerId?: string
  /** Enable TEE-encrypted registration */
  privacy?: boolean
}

export type RecordScannerFilter = {
  /** Program ID to scan (e.g. "loyalty_token.aleo") */
  program: string
  /** Record name to filter for (e.g. "LoyaltyCard") */
  record?: string
  /** Block height to start scanning from */
  startHeight?: number
  /** Block height to stop scanning at */
  endHeight?: number
  /** Only return unspent records (default: true) */
  unspent?: boolean
}

export type ScannedRecord = {
  /** Record owner address */
  owner: string
  /** Parsed record fields as key-value pairs */
  data: Record<string, unknown>
  /** Record plaintext string (for passing to contract functions) */
  plaintext: string
  /** Program ID */
  programId: string
  /** Record name (e.g. "LoyaltyCard") */
  recordName: string
}

/**
 * Creates a record scanner that wraps @provablehq/sdk's RecordScanner service.
 *
 * Handles registration, filtering, decryption, and JWT auth internally.
 * Returns parsed records ready for use with contract functions.
 *
 * @example
 * ```ts
 * const scanner = createRecordScanner({
 *   url: 'https://api.provable.com/scanner',
 *   account,
 *   apiKey: 'your-api-key',
 *   consumerId: 'your-consumer-id',
 * })
 *
 * const cards = await scanner.findRecords({
 *   program: 'loyalty_token.aleo',
 *   record: 'LoyaltyCard',
 *   startHeight: 0,
 * })
 * ```
 */
export function createRecordScanner(config: RecordScannerConfig) {
  const sdkAccount = new Account({ privateKey: config.account.privateKey })
  const viewKey = sdkAccount.viewKey()

  // Build API key config — handle JWT tokens vs plain API keys
  const apiKeyConfig = config.apiKey?.startsWith('eyJ')
    ? { header: 'Authorization', value: `Bearer ${config.apiKey}` }
    : config.apiKey

  const scanner = new RecordScanner({
    url: config.url,
    apiKey: apiKeyConfig,
  })

  let registered = false

  /** Register with the scanner service if not already registered */
  async function ensureRegistered(startHeight: number): Promise<void> {
    if (registered) return

    if (config.privacy) {
      await scanner.registerEncrypted(viewKey, startHeight)
    } else {
      await scanner.register(viewKey, startHeight)
    }
    registered = true
  }

  /** Fetch JWT from Provable API using consumer ID + API key */
  async function fetchJwt(): Promise<string | undefined> {
    if (!config.consumerId || !config.apiKey) return undefined
    if (config.apiKey.startsWith('eyJ')) return config.apiKey // Already a JWT

    // Derive base URL from scanner URL
    let baseUrl = 'https://api.provable.com'
    try {
      const url = new URL(config.url)
      baseUrl = `${url.protocol}//${url.host}`
    } catch { /* use default */ }

    try {
      const response = await fetch(`${baseUrl}/jwts/${config.consumerId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Provable-API-Key': config.apiKey,
        },
      })
      if (!response.ok) return undefined
      const authHeader = response.headers.get('authorization')
      if (!authHeader) return undefined
      return authHeader.replace(/^Bearer\s+/i, '')
    } catch {
      return undefined
    }
  }

  return {
    /**
     * Find records owned by this account matching the given filter.
     *
     * Handles registration and decryption automatically.
     * Returns parsed records with plaintext strings for use in contract calls.
     */
    async findRecords(filter: RecordScannerFilter): Promise<ScannedRecord[]> {
      // Fetch JWT if needed
      if (config.consumerId && config.apiKey && !config.apiKey.startsWith('eyJ')) {
        const jwt = await fetchJwt()
        if (jwt) {
          scanner.setApiKey({ header: 'Authorization', value: `Bearer ${jwt}` })
        }
      }

      // Register with scanner service
      await ensureRegistered(filter.startHeight ?? 0)

      // Query for records
      const records = await scanner.findRecords({
        decrypt: true,
        unspent: filter.unspent ?? true,
        filter: {
          start: filter.startHeight ?? 0,
          end: filter.endHeight,
          program: filter.program,
          record: filter.record,
        },
      })

      // Parse and return
      return records
        .filter((r) => {
          if (filter.record && r.record_name !== filter.record) return false
          return r.record_plaintext || r.record_ciphertext
        })
        .map((r) => {
          let plaintext: string
          if (r.record_plaintext) {
            plaintext = r.record_plaintext
          } else {
            const ciphertext = RecordCiphertext.fromString(r.record_ciphertext!)
            plaintext = ciphertext.decrypt(viewKey).toString()
          }

          return {
            owner: config.account.address,
            data: parseRecordPlaintext(plaintext),
            plaintext,
            programId: filter.program,
            recordName: r.record_name ?? filter.record ?? 'unknown',
          }
        })
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
 *   networkUrl: 'https://api.explorer.provable.com/v1',
 * })
 * ```
 */
export function createAleoClient(options: {
  privateKey: string
  networkUrl: string
  provingMode?: 'delegated' | 'local'
  proverUrl?: string
  apiKey?: string
  consumerId?: string
}): { publicClient: PublicClient; walletClient: WalletClient; account: LocalAccount<'privateKey'> } {
  const account = privateKeyToAccount(options.privateKey)
  const transport = http(options.networkUrl)

  const proving = createProvingConfig({
    mode: options.provingMode ?? 'delegated',
    networkUrl: options.networkUrl,
    proverUrl: options.proverUrl,
    apiKey: options.apiKey,
    consumerId: options.consumerId,
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
