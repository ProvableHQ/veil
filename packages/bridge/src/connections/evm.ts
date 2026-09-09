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

/** Describes either an HTTP endpoint or custom EIP-1193 request transport. */
export type EvmTransportDefinition =
  | { type: 'http'; url: string; fetch?: typeof globalThis.fetch | undefined }
  | { type: 'custom'; request: EvmRequest }

/** Describes either an injected provider account or locally held viem account. */
export type EvmAccount =
  | { type: 'provider'; provider: { request: EvmRequest }; account?: Address | undefined }
  | { type: 'local'; account: LocalAccount }

/**
 * Configures one registry-keyed EVM connection.
 *
 * @property family Discriminator added by {@link evmConnection}.
 * @property transport Lazy public JSON-RPC transport.
 * @property publicClient Existing viem public client used directly.
 * @property account Injected-provider or local signing authority.
 * @property walletClient Existing viem wallet client used directly.
 */
export type EvmConnectionDefinition = {
  family: 'evm'
  transport?: EvmTransportDefinition | undefined
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

/** Represents the receipt fields consumed by bridge protocol actions. */
export type EvmReceipt = Record<string, unknown>

/**
 * Exposes account-free EVM operations used by bridge actions.
 *
 * @property getChainId Reads the current EIP-155 chain id.
 * @property call Executes a read-only EVM call.
 * @property getTransactionReceipt Reads a receipt or returns `null` while unavailable.
 */
export type EvmPublicClient = {
  getChainId: () => Promise<number>
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
 * @property family EVM family discriminator.
 * @property publicClient Required read capability.
 * @property walletClient Optional signing capability.
 */
export type EvmConnection = {
  family: 'evm'
  publicClient: EvmPublicClient
  walletClient?: EvmWalletClient | undefined
}

/**
 * Requires the wallet side of an otherwise readable EVM connection.
 *
 * @property walletClient Account-authorized client used to sign and broadcast.
 */
export type EvmWalletConnection = EvmConnection & { walletClient: EvmWalletClient }

/**
 * Creates a lazy EVM HTTP transport definition.
 *
 * @param url EVM JSON-RPC endpoint.
 * @param options Optional Fetch API override.
 * @returns An inert transport definition.
 * @example const transport = evmHttp('https://rpc.example')
 */
export function evmHttp(url: string, options: EvmHttpOptions = {}): EvmTransportDefinition {
  return { type: 'http', url, fetch: options.fetch }
}

/**
 * Creates a lazy EVM transport from an EIP-1193-compatible request function.
 *
 * @param request EIP-1193 request function.
 * @returns An inert custom transport definition.
 * @example const transport = evmCustom(window.ethereum.request.bind(window.ethereum))
 */
export function evmCustom(request: EvmRequest): EvmTransportDefinition {
  return { type: 'custom', request }
}

/**
 * Adapts an injected EIP-1193 provider for bridge account authorization.
 *
 * @param provider Provider exposing `request`.
 * @param options Optional fixed account; otherwise `eth_accounts` is read lazily.
 * @returns An inert provider-backed account definition.
 * @example const account = evmProvider(window.ethereum)
 */
export function evmProvider(
  provider: { request: EvmRequest },
  options: { account?: Address | undefined } = {},
): EvmAccount {
  return { type: 'provider', provider, account: options.account }
}

/**
 * Creates a local EVM account from a raw 32-byte private key.
 *
 * @param privateKey Hex-encoded private key.
 * @returns An inert locally signing account definition.
 * @example const account = evmPrivateKey(process.env.EVM_PRIVATE_KEY as Hex)
 */
export function evmPrivateKey(privateKey: Hex): EvmAccount {
  return { type: 'local', account: privateKeyToAccount(privateKey) }
}

/**
 * Adapts an existing viem local account for bridge authorization.
 *
 * @param account Viem local account.
 * @returns An inert locally signing account definition.
 * @example const account = evmLocalAccount(privateKeyToAccount(privateKey))
 */
export function evmLocalAccount(account: LocalAccount): EvmAccount {
  return { type: 'local', account }
}

/**
 * Creates and statically validates an inert EVM connection definition.
 *
 * @param config Public transport/client and optional account/wallet client.
 * @returns A registry-ready EVM connection definition.
 * @throws BridgeError When capabilities conflict or local signing has no public client.
 * @example const connection = evmConnection({ transport: evmHttp(rpcUrl), account: evmPrivateKey(key) })
 */
export function evmConnection(
  config: Omit<EvmConnectionDefinition, 'family'>,
): EvmConnectionDefinition {
  if (config.transport && config.publicClient) {
    throw new BridgeError('EVM connection accepts either transport or publicClient, not both')
  }
  if (config.account && config.walletClient) {
    throw new BridgeError('EVM connection accepts either account or walletClient, not both')
  }
  if (!config.transport && !config.publicClient && !config.account && !config.walletClient) {
    throw new BridgeError('EVM connection requires a public or wallet capability')
  }
  if (config.account?.type === 'local' && !config.transport && !config.publicClient) {
    throw new BridgeError('Local EVM accounts require an EVM transport or public client')
  }
  return { family: 'evm', ...config }
}

function transportFor(definition: EvmTransportDefinition, defaultFetch: typeof globalThis.fetch) {
  if (definition.type === 'custom') return custom({ request: definition.request })
  return http(definition.url, { fetchFn: definition.fetch ?? defaultFetch })
}

function normalizePublicClient(client: PublicClient): EvmPublicClient {
  return {
    getChainId: () => client.getChainId(),
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
  const resolveAddress = async (): Promise<Address> => {
    if (client.account) return client.account.address
    const [address] = await client.getAddresses()
    if (!address) throw new BridgeError('EVM wallet has no connected account')
    return address
  }
  return {
    getAddress: resolveAddress,
    sendTransaction: async ({ chainId, from, ...transaction }) => {
      const currentChainId = await client.getChainId()
      if (currentChainId !== chainId) {
        throw new BridgeError(`EVM wallet is connected to chain ${currentChainId}; expected ${chainId}`)
      }
      const account = await resolveAddress()
      if (from && getAddress(from) !== getAddress(account)) {
        throw new BridgeError(`EVM transaction sender ${from} does not match connected account ${account}`)
      }
      return client.sendTransaction({ ...transaction, account: client.account ?? account } as never)
    },
  }
}

/** Materializes an EVM definition into bridge public and wallet clients. */
export function materializeEvmConnection(
  definition: EvmConnectionDefinition,
  defaultFetch: typeof globalThis.fetch,
): EvmConnection {
  const transport = definition.transport ? transportFor(definition.transport, defaultFetch) : undefined
  const viemPublic = definition.publicClient ?? (transport ? createPublicClient({ transport }) : undefined)
  let publicClient = viemPublic ? normalizePublicClient(viemPublic) : undefined
  let walletClient = definition.walletClient ? normalizeWalletClient(definition.walletClient) : undefined

  if (!publicClient && definition.walletClient) {
    const request = definition.walletClient.request as EvmRequest
    publicClient = normalizePublicClient(createPublicClient({ transport: custom({ request }) }))
  }

  if (definition.account?.type === 'provider') {
    const provider = definition.account.provider
    if (!publicClient) publicClient = normalizePublicClient(createPublicClient({ transport: custom(provider) }))
    const account = definition.account.account
    walletClient = {
      getAddress: async () => {
        if (account) return account
        const addresses = await provider.request({ method: 'eth_accounts' })
        const address = Array.isArray(addresses) ? addresses[0] : undefined
        if (typeof address !== 'string') throw new BridgeError('EVM wallet has no connected account')
        return address as Address
      },
      sendTransaction: async ({ chainId, from, to, data, value }) => {
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
  } else if (definition.account?.type === 'local') {
    if (!viemPublic) throw new BridgeError('Local EVM accounts require an EVM transport or public client')
    const localAccount = definition.account.account
    walletClient = {
      getAddress: async () => localAccount.address,
      sendTransaction: async ({ chainId, from, ...transaction }) => {
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
        const localWallet = createWalletClient({
          account: localAccount,
          chain,
          transport: custom({ request: viemPublic.request }, { retryCount: 0 }),
        })
        return localWallet.sendTransaction({ ...transaction, account: localAccount, chain } as never)
      },
    }
  }

  if (!publicClient) throw new BridgeError('EVM connection could not materialize a public client')
  return { family: 'evm', publicClient, walletClient }
}
