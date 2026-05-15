/**
 * @veil/provable
 *
 * Loads `@provablehq/sdk` for a specific Aleo network and exposes the SDK's
 * functionality bound to that network's setup parameters.
 *
 * Usage:
 *   import { loadNetwork } from '@veil/provable'
 *   import { http } from '@veil/core'
 *
 *   const aleo = await loadNetwork('mainnet')
 *
 *   const account = aleo.privateKeyToAccount('APrivateKey1...')
 *   const { publicClient, walletClient } = aleo.createAleoClient({
 *     privateKey: 'APrivateKey1...',
 *     networkUrl: 'https://api.provable.com/v2',
 *   })
 *
 * Switching networks: load a new handle. Existing accounts remain valid —
 * Aleo private keys, view keys, and addresses are network-agnostic.
 */

import { loadNetwork as loadSdk } from '@provablehq/sdk/dynamic.js'
import {
  Account,
  AleoKeyProvider,
  ProgramManager,
  getOrInitConsensusVersionTestHeights,
} from '@provablehq/sdk'
import { DEVNODE_PRIVATE_KEY, DEVNODE_ADDR } from '@veil/devnode'
export { DEVNODE_PRIVATE_KEY, DEVNODE_ADDR }
import type { LocalAccount } from '@veil/core'
import type { ProvingConfig, BuildTransactionOptions, BuildDeploymentOptions, SimulateOptions, ExecuteOptions, RawSimulateResult, RawExecuteResult } from '@veil/core'
import type { OwnedRecord, RecordProvider, StandaloneRecordScanner, RequestRecordsParameters } from '@veil/core'
import type { Network, PublicClient, WalletClient } from '@veil/core'
import {
  createPublicClient,
  createWalletClient,
  http,
  BaseError,
  ProvingError,
  ConfigurationError,
  classifyBroadcastError,
  classifyProvingError,
  waitForConfirmation,
  extractTransitions,
} from '@veil/core'
import type { Decryptor } from '@veil/core'
import { mnemonicToHDKey, type AleoDerivationId } from './mnemonic.js'

export {
  BLS12377HDKey,
  generateMnemonic,
  validateMnemonic,
  validateWord,
  mnemonicToSeed,
  mnemonicToHDKey,
  STANDARD_PATH,
  LEGACY_PATH,
  type AleoDerivationId,
} from './mnemonic.js'

/** Networks supported by `@provablehq/sdk/dynamic.js`. */
export type SupportedNetwork = 'mainnet' | 'testnet'

// `loadSdk('testnet')` and `loadSdk('mainnet')` return modules whose runtime
// classes have the same shape. The narrowed-to-testnet type is used as the
// canonical handle so we don't pass through TS's union-of-modules confusion.
type SdkModule = Awaited<ReturnType<typeof loadSdk<'testnet'>>>

/**
 * A network-bound SDK handle. All functions on this handle use the binary
 * set loaded for the named network.
 *
 * Most key/account operations (`privateKeyToAccount`, `mnemonicToAccount`,
 * `generateAccount`, `decryptRecord`, `verifySignature`) are mathematically
 * network-agnostic — the same private key (or mnemonic) derives the same
 * address and view key regardless of which network's binary was loaded.
 * Proving and program operations (`createProvingConfig`, `createAleoClient`,
 * scanners) are network-bound.
 */
export interface AleoSdk {
  /** The network this handle is bound to. */
  readonly network: SupportedNetwork

  /** Creates a `LocalAccount` from an Aleo private key. */
  privateKeyToAccount(privateKey: string): LocalAccount<'privateKey'>

  /**
   * Creates a `LocalAccount` from a BIP39 mnemonic phrase using Aleo's
   * BLS12-377 HD derivation (matches Shield wallet derivation).
   *
   * Defaults to the SLIP-0044 Aleo coin type path `m/44'/683'`, account
   * index 0. Pass `derivation: 'legacy'` to use the pre-registration path
   * `m/44'/0'` for compatibility with older wallets.
   */
  mnemonicToAccount(
    mnemonic: string,
    options?: { index?: number; derivation?: AleoDerivationId },
  ): LocalAccount<'mnemonic'>

  /** Creates a new random Aleo account. */
  generateAccount(): LocalAccount<'privateKey'>

  /** Decrypts a record ciphertext using a view key. */
  decryptRecord(viewKey: string, ciphertext: string): string

  /** Verifies a signature against a message and address. */
  verifySignature(address: string, message: Uint8Array, signature: string): boolean

  /** Creates an `AleoNetworkClient` for direct SDK access. */
  createNetworkClient(url: string): InstanceType<SdkModule['AleoNetworkClient']>

  /** Creates a `ProvingConfig` for `createWalletClient({ proving })`. */
  createProvingConfig(options: {
    mode: 'delegated' | 'local'
    networkUrl: string
    proverUrl?: string
    apiKey?: string
    consumerId?: string
    account?: LocalAccount<'privateKey'>
    confirmationTimeout?: number
  }): ProvingConfig

  /** Creates a record scanner backed by Provable's Record Scanner Service. */
  createRemoteScanner(options: { url: string; consumerId: string }): RecordProvider

  /** Creates a standalone record scanner with an explicit view key. */
  createStandaloneScanner(options: {
    url: string
    consumerId: string
    viewKey: string
  }): StandaloneRecordScanner

  /** Creates a fully-wired Aleo client from a private key and network URL. */
  createAleoClient(options: {
    privateKey: string
    networkUrl: string
    provingMode?: 'delegated' | 'local'
    proverUrl?: string
    apiKey?: string
    consumerId?: string
    /**
     * Record provider for `requestRecords`. Not wired by default — pass
     * `aleo.createRemoteScanner(...)` or any
     * custom `RecordProvider`. `requestRecords` throws with a setup hint
     * when no provider is configured.
     */
    records?: RecordProvider
  }): { publicClient: PublicClient; walletClient: WalletClient; account: LocalAccount<'privateKey'> }
}

/**
 * Loads `@provablehq/sdk` for the named network and returns a network-bound
 * handle. The SDK module cache memoizes the load — calling twice for the
 * same network returns the same binary set without re-instantiating.
 */
export async function loadNetwork(name: SupportedNetwork): Promise<AleoSdk> {
  const sdk = (await loadSdk(name)) as SdkModule
  return buildSdk(name, sdk)
}

function buildSdk(initialNetwork: SupportedNetwork, initialSdk: SdkModule): AleoSdk {
  // Mutable handle so `createProvingConfig().switchNetwork()` can swap the
  // underlying binary set without rebuilding the wallet client.
  let currentSdk: SdkModule = initialSdk
  const network = initialNetwork
  const {
    Account,
    PrivateKey,
    Signature,
    Address,
    ViewKey,
    AleoNetworkClient,
    RecordScanner,
    RecordCiphertext,
  } = initialSdk



  function mnemonicToAccount(
    mnemonic: string,
    options?: { index?: number; derivation?: AleoDerivationId },
  ): LocalAccount<'mnemonic'> {
    const hd = mnemonicToHDKey(mnemonic, options)
    // wasm-bindgen exports the snake_case name; it is not a typo.
    const privateKey = (PrivateKey as unknown as {
      from_seed_unchecked: (seed: Uint8Array) => InstanceType<SdkModule['PrivateKey']>
    }).from_seed_unchecked(hd.key).to_string()
    return { ...privateKeyToAccount(privateKey), source: 'mnemonic' }
  }

  function generateAccount(): LocalAccount<'privateKey'> {
    const sdkAccount = new Account()
    return privateKeyToAccount(sdkAccount.privateKey().to_string())
  }

  function decryptRecord(viewKeyString: string, ciphertext: string): string {
    return ViewKey.from_string(viewKeyString).decrypt(ciphertext)
  }

  function verifySignature(
    addressString: string,
    message: Uint8Array,
    signatureString: string,
  ): boolean {
    const sig = Signature.from_string(signatureString)
    const addr = Address.from_string(addressString)
    return sig.verify(addr, message)
  }

  function createNetworkClient(url: string): InstanceType<SdkModule['AleoNetworkClient']> {
    return new AleoNetworkClient(url)
  }

  function createProvingConfig(options: {
    mode: 'delegated' | 'local'
    networkUrl: string
    proverUrl?: string
    apiKey?: string
    consumerId?: string
    account?: LocalAccount<'privateKey'>
    /** Timeout in ms for waiting for transaction confirmation (default: 300_000 = 5 min) */
    confirmationTimeout?: number
  }): ProvingConfig {
    // Each call reads from currentSdk so switchNetwork can swap the binary set
    // without rebuilding the wallet client.
    let networkUrl = options.networkUrl
    let keyProvider = new currentSdk.AleoKeyProvider()
    keyProvider.useCache(true)

    return {
      mode: options.mode,
      url: options.proverUrl,

      buildTransaction: async (txOptions: BuildTransactionOptions) => {
        const programManager = new currentSdk.ProgramManager(
          networkUrl,
          keyProvider,
          undefined,
        )

        if (options.account) {
          const sdkAccount = new currentSdk.Account({ privateKey: options.account.privateKey })
          programManager.setAccount(sdkAccount)
        }

        // The user-facing API takes dynamic-dispatch import names (`string[]`);
        // the SDK needs a name → source map covering BOTH the program's static
        // imports (declared in the `import` block) and the user's dynamic ones.
        // Auto-discover static imports first, then add the user-provided
        // dynamic ones on top. The SDK's ProgramImports values can be string
        // or Program; we mirror its return type instead of reconstructing it.
        type SdkProgramImports = Awaited<
          ReturnType<InstanceType<SdkModule['AleoNetworkClient']>['getProgramImports']>
        >
        let resolvedImports: SdkProgramImports | undefined
        if (txOptions.imports && txOptions.imports.length > 0) {
          const programSource = await programManager.networkClient.getProgram(txOptions.programName)
          const staticImports = await programManager.networkClient.getProgramImports(programSource)
          const merged: SdkProgramImports = { ...staticImports }
          for (const name of txOptions.imports) {
            merged[name] = await programManager.networkClient.getProgram(name)
          }
          resolvedImports = merged
        }

        const tx = await programManager.buildExecutionTransaction({
          programName: txOptions.programName,
          functionName: txOptions.functionName,
          priorityFee: 0,
          privateFee: txOptions.privateFee ?? false,
          inputs: txOptions.inputs,
          ...(resolvedImports ? { imports: resolvedImports } : {}),
        })

        return JSON.parse(tx.toString())
      },

      buildDeployment: async (deployOptions: BuildDeploymentOptions) => {
        const programManager = new currentSdk.ProgramManager(
          networkUrl,
          keyProvider,
          undefined,
        )

        if (options.account) {
          const sdkAccount = new currentSdk.Account({ privateKey: options.account.privateKey })
          programManager.setAccount(sdkAccount)
        }

        const tx = await programManager.buildDeploymentTransaction(
          deployOptions.program,
          0,
          deployOptions.privateFee ?? false,
        )

        return JSON.parse(tx.toString())
      },

      simulate: async (simOptions: SimulateOptions): Promise<RawSimulateResult> => {
        const programManager = new currentSdk.ProgramManager(networkUrl, keyProvider, undefined)
        if (options.account) {
          programManager.setAccount(new currentSdk.Account({ privateKey: options.account.privateKey }))
        }

        // Self-custody decryptor: same view-key-based decryptor as the execute path.
        const accountViewKey = options.account ? ViewKey.from_string(options.account.viewKey) : undefined
        const decryptor: Decryptor | undefined = accountViewKey
          ? (ciphertext: string) => {
              const ct = RecordCiphertext.fromString(ciphertext)
              return ct.isOwner(accountViewKey) ? ct.decrypt(accountViewKey).toString() : null
            }
          : undefined

        // `buildAuthorization` runs the function (with cross-program calls) and produces an
        // Authorization whose transitions carry program/function metadata and the actual
        // outputs — same structure a confirmed Transaction has, minus the proof.
        const authorization = await programManager.buildAuthorization({
          programName: simOptions.programName,
          functionName: simOptions.functionName,
          inputs: simOptions.inputs,
          programSource: simOptions.programSource,
          programImports: simOptions.programImports,
        })

        // Convert the wasm Transition objects into the wire-shaped tx that extractTransitions
        // consumes. Private outputs come back from an Authorization as TVK-encrypted ciphertexts
        // (Aleo's on-chain privacy model); decrypt with the caller's TVK first so plaintext
        // values are visible. `transition.toString()` emits the same wire-format JSON the chain
        // returns from `/transaction/confirmed/{id}` — Aleo-typed string values like '10u32',
        // 'aleo1...', or 'record1...' under each output's `value`.
        const tx = {
          execution: {
            transitions: authorization.transitions().map((t: any) => {
              let source = t
              if (accountViewKey) {
                try {
                  source = t.decryptTransition(t.tvk(accountViewKey))
                } catch {
                  // Foreign transition signed by another caller — leave outputs encrypted.
                }
              }
              return JSON.parse(source.toString())
            }),
          },
        }

        const { transitions, outputs } = extractTransitions(tx, decryptor)
        return { transitions, outputs }
      },

      execute: async (execOptions: ExecuteOptions): Promise<RawExecuteResult> => {
        const programManager = new currentSdk.ProgramManager(networkUrl, keyProvider, undefined)
        if (options.account) {
          programManager.setAccount(new currentSdk.Account({ privateKey: options.account.privateKey }))
        }

        /** Convert microcredits (Veil API) to credits (SDK API) for priority fee */
        const priorityFee = Number(execOptions.fee) / 1_000_000

        /** Self-custody decryptor: use the local account's view key to decrypt owned record ciphertexts. */
        const accountViewKey = options.account ? ViewKey.from_string(options.account.viewKey) : undefined
        const decryptor: Decryptor | undefined = accountViewKey
          ? (ciphertext: string) => {
              const ct = RecordCiphertext.fromString(ciphertext)
              return ct.isOwner(accountViewKey) ? ct.decrypt(accountViewKey).toString() : null
            }
          : undefined

        /** Build a Veil publicClient bound to the current networkUrl for chain polling. */
        const buildPollingClient = () =>
          createPublicClient({ transport: http(networkUrl, { network: network as Network }) })

        if (options.mode === 'delegated') {
          if (!options.proverUrl) throw new ConfigurationError('Delegated execution requires proverUrl. Pass proverUrl to createProvingConfig or createAleoClient.')

          let response: any
          try {
            const provingRequest = await programManager.provingRequest({
              programName: execOptions.programName,
              programSource: execOptions.programSource,
              programImports: execOptions.programImports,
              functionName: execOptions.functionName,
              inputs: execOptions.inputs,
              priorityFee,
              privateFee: execOptions.privateFee ?? false,
              broadcast: true,
            })

            const dpsClient = new AleoNetworkClient(options.proverUrl)
            response = await dpsClient.submitProvingRequest({
              provingRequest,
              url: options.proverUrl,
              apiKey: options.apiKey,
              consumerId: options.consumerId,
            })
          } catch (e) {
            if (e instanceof BaseError) throw e
            throw classifyProvingError(e)
          }

          const txId = response.transaction?.id
          if (!txId) throw new ConfigurationError('DPS response did not contain a transaction ID — check prover service configuration.')

          const confirmedTx = await waitForConfirmation(buildPollingClient(), txId, options.confirmationTimeout)
          const { transitions, outputs } = extractTransitions(confirmedTx, decryptor)
          return { transactionId: txId, transitions, outputs }

        } else {
          let tx: any
          try {
            tx = await programManager.buildExecutionTransaction({
              programName: execOptions.programName,
              functionName: execOptions.functionName,
              inputs: execOptions.inputs,
              priorityFee,
              privateFee: execOptions.privateFee ?? false,
              program: execOptions.programSource,
              imports: execOptions.programImports,
            })
          } catch (e) {
            if (e instanceof BaseError) throw e
            throw new ProvingError({ message: e instanceof Error ? e.message : String(e), cause: e as Error })
          }

          let txId: string
          try {
            const submitClient = new AleoNetworkClient(networkUrl)
            submitClient.setVerboseErrors(false)
            txId = await submitClient.submitTransaction(tx)
          } catch (e) {
            if (e instanceof BaseError) throw e
            throw classifyBroadcastError(e)
          }

          const confirmedTx = await waitForConfirmation(buildPollingClient(), txId, options.confirmationTimeout)
          const { transitions, outputs } = extractTransitions(confirmedTx, decryptor)
          return { transactionId: txId, transitions, outputs }
        }
      },

      decrypt: async (cipherText) => {
        if (!options.account?.viewKey) {
          throw new Error(
            'decrypt requires an account with a viewKey on the proving config.',
          )
        }
        return currentSdk.ViewKey.from_string(options.account.viewKey).decrypt(cipherText)
      },

      switchNetwork: async (newNetwork) => {
        if (newNetwork !== 'mainnet' && newNetwork !== 'testnet') {
          throw new Error(
            `loadNetwork supports 'mainnet' or 'testnet' (received '${newNetwork}').`,
          )
        }
        currentSdk = (await loadSdk(newNetwork as SupportedNetwork)) as SdkModule
        keyProvider = new currentSdk.AleoKeyProvider()
        keyProvider.useCache(true)
      },
    }
  }

  function createRemoteScanner(options: { url: string; consumerId: string }): RecordProvider {
    let scanner: InstanceType<SdkModule['RecordScanner']> | undefined

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

        return (records ?? []) as unknown as OwnedRecord[]
      },
    }
  }

  function createStandaloneScanner(options: {
    url: string
    consumerId: string
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

        return (records ?? []) as unknown as OwnedRecord[]
      },
    }
  }

  function createAleoClient(options: {
    privateKey: string
    networkUrl: string
    provingMode?: 'delegated' | 'local'
    proverUrl?: string
    apiKey?: string
    consumerId?: string
    records?: RecordProvider
  }): { publicClient: PublicClient; walletClient: WalletClient; account: LocalAccount<'privateKey'> } {
    const account = privateKeyToAccount(options.privateKey)
    const transport = http(options.networkUrl, { network: network as Network })

    const proving = createProvingConfig({
      mode: options.provingMode ?? 'delegated',
      networkUrl: options.networkUrl,
      proverUrl: options.proverUrl,
      apiKey: options.apiKey,
      consumerId: options.consumerId,
      account,
    })

    const publicClient = createPublicClient({ transport })

    if (options.records) {
      options.records.setAccount({ viewKey: account.viewKey })
    }

    const walletClient = createWalletClient({
      account,
      transport,
      proving,
      ...(options.records ? { recordProvider: options.records } : {}),
    })

    return { publicClient, walletClient, account }
  }

  return {
    network,
    privateKeyToAccount,
    mnemonicToAccount,
    generateAccount,
    decryptRecord,
    verifySignature,
    createNetworkClient,
    createProvingConfig,
    createRemoteScanner,
    createStandaloneScanner,
    createAleoClient,
  }
}

// ---------------------------------------------------------------------------
// Standalone exports — synchronous helpers and devnode client factory.
// These use the statically-imported SDK (testnet binaries) so they work
// without an awaited loadNetwork() call.
// ---------------------------------------------------------------------------

// Consensus version heights required by the WASM layer for devnode transactions.
// All 14 versions are available from block 0 so devnode builds succeed without a live chain.
const DEVNODE_CONSENSUS_HEIGHTS = '0,1,2,3,4,5,6,7,8,9,10,11,12,13'

function privateKeyToAccount(privateKey: string): LocalAccount<'privateKey'> {
  const sdkAccount = new Account({ privateKey })
  const address = sdkAccount.address().to_string()
  const viewKey = sdkAccount.viewKey().to_string()

  const signFn = async (message: Uint8Array): Promise<Uint8Array> => {
    const sig = sdkAccount.sign(message)
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

/** Creates a new random Aleo account (uses static SDK binaries). */
export function generateAccount(): LocalAccount<'privateKey'> {
  const sdkAccount = new Account()
  return privateKeyToAccount(sdkAccount.privateKey().to_string())
}

/**
 * Creates a fully-wired client pair pointing at a local Aleo Devnode instance.
 *
 * Devnode is a lightweight local Aleo node (similar to Foundry's Anvil) that
 * bypasses consensus and skips ZK proof generation, enabling rapid program iteration.
 * The seeded account is pre-funded; both key and socket address can be overridden.
 *
 * @example
 * ```ts
 * // Zero-config — uses seeded key and localhost:3030
 * const { publicClient, walletClient, account } = createDevnodeClient()
 *
 * // Custom key or socket address
 * const { publicClient, walletClient, account } = createDevnodeClient({
 *   privateKey: 'APrivateKey1...',
 *   socketAddr: '127.0.0.1:4040',
 * })
 * ```
 */
export function createDevnodeClient(options?: {
  privateKey?: string
  /** Socket address of the devnode, e.g. "127.0.0.1:3030" */
  socketAddr?: string
}): { publicClient: PublicClient; walletClient: WalletClient; account: LocalAccount<'privateKey'> } {
  const url = `http://${options?.socketAddr ?? DEVNODE_ADDR}`
  const account = privateKeyToAccount(options?.privateKey ?? DEVNODE_PRIVATE_KEY)
  const sdkAccount = new Account({ privateKey: account.privateKey })
  const transport = http(url, { network: 'testnet' })

  const keyProvider = new AleoKeyProvider()
  keyProvider.useCache(true)

  const proving: ProvingConfig = {
    mode: 'devnode',
    buildDeployment: async (deployOptions: BuildDeploymentOptions) => {
      getOrInitConsensusVersionTestHeights(DEVNODE_CONSENSUS_HEIGHTS)
      const programManager = new ProgramManager(url, keyProvider, undefined)
      programManager.setAccount(sdkAccount)
      const tx = await programManager.buildDevnodeDeploymentTransaction({
        program: deployOptions.program,
        priorityFee: 0,
        privateFee: deployOptions.privateFee ?? false,
      })
      return JSON.parse(tx.toString())
    },
    buildTransaction: async (txOptions: BuildTransactionOptions) => {
      getOrInitConsensusVersionTestHeights(DEVNODE_CONSENSUS_HEIGHTS)
      const programManager = new ProgramManager(url, keyProvider, undefined)
      programManager.setAccount(sdkAccount)

      // Fetch program sources for any call.dynamic targets the caller declared,
      // and recursively include their static imports as well.
      let imports: Record<string, string> | undefined
      if (txOptions.imports && txOptions.imports.length > 0) {
        imports = {}
        const queue = [...txOptions.imports]
        const seen = new Set<string>()
        while (queue.length > 0) {
          const name = queue.shift()!
          if (seen.has(name)) continue
          seen.add(name)
          const source = await programManager.networkClient.getProgram(name)
          imports[name] = source
          const transitive = await programManager.networkClient.getProgramImports(source)
          for (const transitiveName of Object.keys(transitive)) {
            if (!seen.has(transitiveName)) queue.push(transitiveName)
          }
        }
      }

      const tx = await programManager.buildDevnodeExecutionTransaction({
        programName: txOptions.programName,
        functionName: txOptions.functionName,
        priorityFee: 0,
        privateFee: txOptions.privateFee ?? false,
        inputs: txOptions.inputs,
        ...(imports ? { imports } : {}),
      })
      return JSON.parse(tx.toString())
    },
  }

  const publicClient = createPublicClient({ transport })
  const walletClient = createWalletClient({ account, transport, proving })

  return { publicClient, walletClient, account }
}
