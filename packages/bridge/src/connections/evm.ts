import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  http,
  type Address,
  type Hash,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { BridgeError } from '../errors/bridgeErrors.js'

/**
 * Sends one EIP-1193-compatible request.
 *
 * @param args JSON-RPC method and parameters.
 * @returns The provider's decoded JSON-RPC result.
 */
export type EvmRequest = (args: {
  method: string
  params?: readonly unknown[] | Record<string, unknown> | undefined
}) => Promise<unknown>

/**
 * Configures Fetch API behavior for an EVM HTTP transport.
 *
 * @property fetch Optional Fetch API implementation used instead of the client-level transport.
 */
export type EvmHttpOptions = { fetch?: typeof globalThis.fetch | undefined }

/** Stores either an HTTP endpoint or custom EIP-1193 request function without contacting Ethereum. */
export type EvmTransport =
  | { type: 'http'; url: string; fetch?: typeof globalThis.fetch | undefined }
  | { type: 'custom'; request: EvmRequest }

/** Selects whether an injected provider or application-held viem account authorizes transactions. */
export type EvmAccount =
  | { type: 'provider'; provider: { request: EvmRequest }; account?: Address | undefined }
  | { type: 'local'; account: LocalAccount }

/**
 * Configures EVM network and optional wallet access for one named bridge chain.
 *
 * @property transport Lazy public JSON-RPC transport.
 * @property publicClient Existing viem public client used directly.
 * @property account Injected-provider or local signing authority.
 * @property walletClient Existing viem wallet client used directly.
 */
export type EvmClientConfig = {
  transport?: EvmTransport | undefined
  publicClient?: PublicClient | undefined
  account?: EvmAccount | undefined
  walletClient?: WalletClient | undefined
}

/**
 * Describes an EVM call used by bridge protocol actions.
 *
 * @property to Contract address.
 * @property data ABI-encoded calldata.
 * @property account Optional call sender.
 */
export type EvmCallParameters = { to: Address; data: Hex; account?: Address | undefined }

/**
 * Describes an EVM transaction used by bridge protocol actions.
 *
 * @property chainId Expected EIP-155 chain id, checked immediately before submission.
 * @property from Optional expected sender, checked against the connected account.
 * @property to Transaction destination.
 * @property data ABI-encoded calldata.
 * @property value Optional native-token value in wei.
 */
export type EvmTransactionParameters = {
  chainId: number
  from?: Address | undefined
  to: Address
  data: Hex
  value?: bigint | undefined
}

/**
 * Represents normalized EVM receipt fields consumed by bridge actions.
 *
 * @property status Viem-normalized execution result.
 * @property transactionHash Canonical transaction hash when returned by the client.
 * @property logs Receipt-log envelopes used to verify protocol events.
 */
export type EvmReceipt = {
  status: 'success' | 'reverted'
  transactionHash: Hash
  logs: readonly {
    address?: Address | undefined
    data: Hex
    topics: readonly Hex[]
    logIndex?: number | undefined
  }[]
}

/**
 * Exposes account-free EVM operations used by bridge actions.
 *
 * @property getChainId Reads the current EIP-155 chain id.
 * @property getBalance Reads one account's native-currency balance in atomic units.
 * @property call Executes a read-only EVM call.
 * @property getTransactionReceipt Reads a receipt or returns `null` while unavailable.
 */
export type EvmPublicClient = {
  getChainId: () => Promise<number>
  getBalance: (address: Address) => Promise<bigint>
  call: (params: EvmCallParameters) => Promise<Hex>
  getTransactionReceipt: (hash: Hash) => Promise<EvmReceipt | null>
}

/**
 * Exposes account-authorized EVM operations used by bridge actions.
 *
 * @property getAddress Resolves the active account.
 * @property sendTransaction Validates chain and sender, then signs and broadcasts.
 */
export type EvmWalletClient = {
  getAddress: () => Promise<Address>
  sendTransaction: (params: EvmTransactionParameters) => Promise<Hash>
}

/**
 * Holds materialized EVM public and wallet capabilities.
 *
 * @property family Prevents this client from being used for a Solana or Aleo route stored under the wrong chain identifier.
 * @property publicClient Required read capability.
 * @property walletClient Optional signing capability.
 */
export type EvmClient = {
  family: 'evm'
  publicClient: EvmPublicClient
  walletClient?: EvmWalletClient | undefined
}

/**
 * Defines the EVM JSON-RPC endpoint used when a bridge action reads or submits.
 *
 * Creating the transport does not contact the endpoint.
 *
 * @param url EVM JSON-RPC endpoint contacted by the resulting client.
 * @param options Optional Fetch API implementation. Defaults to `globalThis.fetch` when the client is created.
 * @returns Deferred HTTP configuration accepted by `createEvmClient`.
 * @example const transport = evmHttp('https://rpc.example')
 */
export function evmHttp(url: string, options: EvmHttpOptions = {}): EvmTransport {
  return { type: 'http', url, fetch: options.fetch }
}

/**
 * Defines EVM network access through an application-supplied EIP-1193 request function.
 *
 * Creating the transport does not call the request function.
 *
 * @param request Function that sends JSON-RPC methods when a bridge action needs network access.
 * @returns Deferred custom transport configuration accepted by `createEvmClient`.
 * @example const transport = evmCustom(window.ethereum.request.bind(window.ethereum))
 */
export function evmCustom(request: EvmRequest): EvmTransport {
  return { type: 'custom', request }
}

/**
 * Selects an injected EIP-1193 wallet to authorize EVM bridge transactions.
 *
 * The provider retains custody of the account and controls every signature
 * request. This helper does not connect to the wallet or request a signature.
 *
 * @param provider Browser or application wallet exposing an EIP-1193 `request` function.
 * @param options Optional account that MUST authorize transactions. Defaults to the first account returned by `eth_accounts` at submission time.
 * @returns Deferred wallet configuration accepted by `createEvmClient`.
 * @example const account = evmProvider(window.ethereum)
 */
export function evmProvider(
  provider: { request: EvmRequest },
  options: { account?: Address | undefined } = {},
): EvmAccount {
  return { type: 'provider', provider, account: options.account }
}

/**
 * Selects an application-held EVM private key for unattended bridge transactions.
 *
 * The key is converted to a viem account that signs on the caller's device or
 * server. This helper does not contact a chain or submit a transaction; the
 * application remains responsible for keeping the key secret.
 *
 * @param privateKey Secret 32-byte hexadecimal key held by the application.
 * @returns Deferred local signing configuration accepted by `createEvmClient`.
 * @example const account = evmPrivateKey(process.env.EVM_PRIVATE_KEY as Hex)
 */
export function evmPrivateKey(privateKey: Hex): EvmAccount {
  return { type: 'local', account: privateKeyToAccount(privateKey) }
}

/**
 * Selects an existing viem local account for unattended bridge transactions.
 *
 * The account signs on the caller's device or server. This helper does not
 * contact a chain, request an external wallet approval, or submit a transaction.
 *
 * @param account Viem account whose signer and address remain owned by the application.
 * @returns Deferred local signing configuration accepted by `createEvmClient`.
 * @example const account = evmLocalAccount(privateKeyToAccount(privateKey))
 */
export function evmLocalAccount(account: LocalAccount): EvmAccount {
  return { type: 'local', account }
}

/**
 * Creates the EVM client used to read bridge state and optionally authorize transactions.
 *
 * Construction wires together existing clients or deferred transports without
 * making an RPC request. Read-only actions need only a transport or public
 * client; fund-moving actions also require an account or wallet client.
 *
 * @param config EVM network access and optional wallet authorization supplied by the application.
 * @returns EVM read and optional wallet capabilities used by bridge actions.
 * @throws BridgeError When multiple alternatives are supplied for one capability, no capability is supplied, or a local signer has no network access.
 * @example const client = createEvmClient({ transport: evmHttp(rpcUrl), account: evmPrivateKey(key) })
 */
export function createEvmClient(
  config: EvmClientConfig,
): EvmClient {
  if (config.transport && config.publicClient) {
    throw new BridgeError('EVM client accepts either transport or publicClient, not both')
  }
  if (config.account && config.walletClient) {
    throw new BridgeError('EVM client accepts either account or walletClient, not both')
  }
  if (!config.transport && !config.publicClient && !config.account && !config.walletClient) {
    throw new BridgeError('EVM client requires a public or wallet capability')
  }
  if (config.account?.type === 'local' && !config.transport && !config.publicClient) {
    throw new BridgeError('Local EVM accounts require an EVM transport or public client')
  }
  return materializeEvmClient(config, globalThis.fetch)
}

function transportFor(transport: EvmTransport, defaultFetch: typeof globalThis.fetch) {
  if (transport.type === 'custom') return custom({ request: transport.request })
  return http(transport.url, { fetchFn: transport.fetch ?? defaultFetch })
}

function normalizePublicClient(client: PublicClient): EvmPublicClient {
  return {
    getChainId: () => client.getChainId(),
    getBalance: (address) => client.getBalance({ address }),
    call: async (params) => (await client.call(params)).data ?? '0x',
    getTransactionReceipt: async (hash) => {
      try {
        return await client.getTransactionReceipt({ hash }) as unknown as EvmReceipt
      } catch (error) {
        if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError') return null
        throw error
      }
    },
  }
}

function normalizeWalletClient(client: WalletClient): EvmWalletClient {
  // A viem WalletClient may carry a local account or obtain accounts from an
  // injected provider. Resolve either form only when authorization is needed.
  const resolveAddress = async (): Promise<Address> => {
    if (client.account) return client.account.address
    const [address] = await client.getAddresses()
    if (!address) throw new BridgeError('EVM wallet has no connected account')
    return address
  }
  return {
    getAddress: resolveAddress,
    sendTransaction: async ({ chainId, from, ...transaction }) => {
      // Public reads and wallet submissions can be backed by different viem
      // clients. Bind the wallet itself to the intended chain before broadcast.
      const currentChainId = await client.getChainId()
      if (currentChainId !== chainId) {
        throw new BridgeError(`EVM wallet is connected to chain ${currentChainId}; expected ${chainId}`)
      }
      const account = await resolveAddress()
      // Passing the resolved account supports accountless injected clients;
      // passing the local account object preserves its local signing behavior.
      if (from && getAddress(from) !== getAddress(account)) {
        throw new BridgeError(`EVM transaction sender ${from} does not match connected account ${account}`)
      }
      return client.sendTransaction({ ...transaction, account: client.account ?? account } as never)
    },
  }
}

/** Normalizes viem, EIP-1193, and local-account inputs behind the bridge's EVM capabilities. */
function materializeEvmClient(
  config: EvmClientConfig,
  defaultFetch: typeof globalThis.fetch,
): EvmClient {
  const transport = config.transport ? transportFor(config.transport, defaultFetch) : undefined
  // Prefer caller-owned viem clients. A deferred transport is materialized only
  // when the corresponding public capability was not supplied directly.
  const viemPublic = config.publicClient ?? (transport ? createPublicClient({ transport }) : undefined)
  let publicClient = viemPublic ? normalizePublicClient(viemPublic) : undefined
  let walletClient = config.walletClient ? normalizeWalletClient(config.walletClient) : undefined

  if (!publicClient && config.walletClient) {
    // A viem wallet transport can answer read-only JSON-RPC calls. Expose that
    // capability when no separate public transport was configured.
    const request = config.walletClient.request as EvmRequest
    publicClient = normalizePublicClient(createPublicClient({ transport: custom({ request }) }))
  }

  if (config.account?.type === 'provider') {
    const provider = config.account.provider
    if (!publicClient) publicClient = normalizePublicClient(createPublicClient({ transport: custom(provider) }))
    const account = config.account.account
    walletClient = {
      getAddress: async () => {
        if (account) return account
        const addresses = await provider.request({ method: 'eth_accounts' })
        const address = Array.isArray(addresses) ? addresses[0] : undefined
        if (typeof address !== 'string') throw new BridgeError('EVM wallet has no connected account')
        return address as Address
      },
      sendTransaction: async ({ chainId, from, to, data, value }) => {
        // EIP-1193 providers own chain selection. Refuse to request a signature
        // on a different chain instead of silently switching or misdirecting funds.
        const current = await provider.request({ method: 'eth_chainId' })
        if (typeof current !== 'string' || Number.parseInt(current, 16) !== chainId) {
          throw new BridgeError(`EVM wallet is connected to chain ${String(current)}; expected ${chainId}`)
        }
        const sender = from ?? await walletClient!.getAddress()
        const hash = await provider.request({
          method: 'eth_sendTransaction',
          params: [{ from: sender, to, data, ...(value === undefined ? {} : { value: `0x${value.toString(16)}` }) }],
        })
        if (typeof hash !== 'string') throw new BridgeError('EVM wallet returned an invalid transaction hash')
        return hash as Hash
      },
    }
  } else if (config.account?.type === 'local') {
    if (!viemPublic) throw new BridgeError('Local EVM accounts require an EVM transport or public client')
    const localAccount = config.account.account
    walletClient = {
      getAddress: async () => localAccount.address,
      sendTransaction: async ({ chainId, from, ...transaction }) => {
        // Local signing still derives nonce, gas, and broadcast behavior from
        // the public transport, so bind that transport to the requested chain.
        const currentChainId = await viemPublic.getChainId()
        if (currentChainId !== chainId) {
          throw new BridgeError(`EVM transport is connected to chain ${currentChainId}; expected ${chainId}`)
        }
        if (from && getAddress(from) !== getAddress(localAccount.address)) {
          throw new BridgeError(`EVM transaction sender ${from} does not match local account ${localAccount.address}`)
        }
        const chain = viemPublic.chain ?? defineChain({
          id: chainId,
          name: `EVM chain ${chainId}`,
          nativeCurrency: { name: 'Native token', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: [] } },
        })
        // Reuse the caller's public-client request path for submission. This
        // keeps custom transports, batching, and authentication consistent.
        const localWallet = createWalletClient({
          account: localAccount,
          chain,
          transport: custom({ request: viemPublic.request }, { retryCount: 0 }),
        })
        return localWallet.sendTransaction({ ...transaction, account: localAccount, chain } as never)
      },
    }
  }

  if (!publicClient) throw new BridgeError('EVM client could not materialize a public client')
  return { family: 'evm', publicClient, walletClient }
}
