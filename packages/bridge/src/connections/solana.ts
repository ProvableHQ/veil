import { BridgeError } from '../errors/bridgeErrors.js'
import bs58 from 'bs58'
import { loadKit } from '../solana/kit.js'
import { createSolanaRpcClient, type SolanaRpcClient } from '../solana/rpc.js'
import type { SolanaRpcHttpTransport } from '../types/solana.js'

const SOLANA_SIGN_AND_SEND_TRANSACTION_FEATURE = 'solana:signAndSendTransaction'

/** Provides the official Solana mainnet JSON-RPC endpoint. */
export const DEFAULT_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com'

type SolanaSignAndSendTransactionFeature = {
  signAndSendTransaction: (input: {
    transaction: Uint8Array
    account: { address: string; publicKey: Uint8Array }
    chain: string
  }) => Promise<readonly { signature: Uint8Array }[]>
}

/**
 * Sends one Solana JSON-RPC method through an application transport.
 * @param method JSON-RPC method name.
 * @param params Positional JSON-RPC parameters.
 * @returns The decoded method result.
 */
export type SolanaRequest = (method: string, params: unknown[]) => Promise<unknown>

/**
 * Configures Fetch API behavior for a Solana HTTP transport.
 * @property fetch Optional fetch-compatible JSON-RPC transport.
 */
export type SolanaHttpOptions = { fetch?: SolanaRpcHttpTransport | undefined }

/** Describes a lazy Solana network transport. */
export type SolanaTransport =
  | { type: 'http'; url: string; fetch?: SolanaRpcHttpTransport | undefined }
  | { type: 'custom'; request: SolanaRequest }

/** Describes a Solana account authority without network access. */
export type SolanaAccount =
  | {
      type: 'wallet'
      wallet: { features: Record<string, unknown> }
      account: { address: string; publicKey: Uint8Array }
      chain: string
    }
  | { type: 'local'; secretKeyBytes: Uint8Array }

/**
 * Configures one registry-keyed Solana client.
 * @property transport Required public JSON-RPC transport.
 * @property account Optional Wallet Standard or local-key signing authority.
 */
export type SolanaClientConfig = {
  transport: SolanaTransport
  account?: SolanaAccount | undefined
}

/**
 * Exposes account-free Solana operations used by bridge actions.
 * @property sendTransaction Broadcasts a fully signed wire transaction.
 */
export type SolanaPublicClient = SolanaRpcClient & {
  sendTransaction: (signedTransaction: Uint8Array) => Promise<{ signature: string }>
}

/**
 * Exposes account-authorized Solana operations used by bridge actions.
 * @property getAddress Resolves the fee payer address.
 * @property sendTransaction Adds the fee-payer signature and broadcasts or delegates both operations to a wallet.
 */
export type SolanaWalletClient = {
  getAddress: () => Promise<string>
  sendTransaction: (wireTransaction: Uint8Array) => Promise<{ signature: string }>
}

/**
 * Holds materialized Solana public and wallet capabilities.
 * @property family Solana family discriminator.
 * @property publicClient Read and broadcast capability.
 * @property walletClient Optional signing capability.
 */
export type SolanaClient = {
  family: 'solana'
  publicClient: SolanaPublicClient
  walletClient?: SolanaWalletClient | undefined
}

/**
 * Creates a lazy Solana HTTP transport.
 * @param url Solana JSON-RPC endpoint.
 * @param options Optional fetch-compatible override.
 * @returns An inert Solana transport.
 * @example const transport = solanaHttp('https://api.mainnet-beta.solana.com')
 */
export function solanaHttp(url: string, options: SolanaHttpOptions = {}): SolanaTransport {
  return { type: 'http', url, fetch: options.fetch }
}

/**
 * Creates a lazy Solana transport from a JSON-RPC request function.
 * @param request Application JSON-RPC request function.
 * @returns An inert custom transport.
 * @example const transport = solanaCustom((method, params) => rpc.request(method, params))
 */
export function solanaCustom(request: SolanaRequest): SolanaTransport {
  return { type: 'custom', request }
}

/**
 * Adapts a Wallet Standard account for Solana bridge authorization.
 * @param params Wallet, selected account, and Wallet Standard chain identifier.
 * @returns An inert wallet-backed account definition.
 * @example const account = solanaWallet({ wallet, account: wallet.accounts[0], chain: 'solana:mainnet' })
 */
export function solanaWallet(params: Omit<Extract<SolanaAccount, { type: 'wallet' }>, 'type'>): SolanaAccount {
  return { type: 'wallet', ...params }
}

/**
 * Creates a network-free Solana local-key account definition.
 * @param secretKeyBytes Solana CLI-format 64-byte secret key.
 * @returns An inert locally signing account definition.
 * @throws BridgeError When the key is not exactly 64 bytes.
 * @example const account = solanaKeyPair(secretKeyBytes)
 */
export function solanaKeyPair(secretKeyBytes: Uint8Array): SolanaAccount {
  if (secretKeyBytes.length !== 64) throw new BridgeError('Solana secret key must contain exactly 64 bytes')
  return { type: 'local', secretKeyBytes: new Uint8Array(secretKeyBytes) }
}

/**
 * Creates a Solana bridge client with public access and optional wallet authorization.
 *
 * Construction is local and performs no RPC requests.
 *
 * @param config Required transport and optional account.
 * @returns A registry-ready Solana client.
 * @throws BridgeError When the transport is absent.
 * @example const client = createSolanaClient({ transport: solanaHttp(rpcUrl), account: solanaKeyPair(key) })
 */
export function createSolanaClient(
  config: SolanaClientConfig,
): SolanaClient {
  if (!config.transport) throw new BridgeError('Solana client requires a transport')
  return materializeSolanaClient(config, globalThis.fetch)
}

/** Builds the Solana public and optional wallet capabilities. */
function materializeSolanaClient(
  config: SolanaClientConfig,
  defaultFetch: SolanaRpcHttpTransport,
): SolanaClient {
  const transportDefinition = config.transport
  const httpTransport: SolanaRpcHttpTransport = transportDefinition.type === 'http'
    ? transportDefinition.fetch ?? defaultFetch
    : async (_url, init) => {
        const body = JSON.parse(init.body) as { method: string; params: unknown[] }
        return { ok: true, status: 200, json: async () => ({ result: await transportDefinition.request(body.method, body.params) }) }
      }
  const url = transportDefinition.type === 'http' ? transportDefinition.url : 'solana:custom'
  const rpcClient = createSolanaRpcClient({ url, transport: httpTransport })
  const publicClient: SolanaPublicClient = {
    ...rpcClient,
    async sendTransaction(signedTransaction) {
      const base64 = btoa(String.fromCharCode(...signedTransaction))
      const sendOptions = { encoding: 'base64', preflightCommitment: 'confirmed' }
      if (transportDefinition.type === 'custom') {
        const signature = await transportDefinition.request('sendTransaction', [base64, sendOptions])
        if (typeof signature !== 'string' || !signature) throw new BridgeError('Solana RPC sendTransaction returned an invalid signature')
        return { signature }
      }
      const response = await httpTransport(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [base64, sendOptions] }),
        cache: 'no-store',
      })
      const body = await response.json() as { result?: unknown; error?: { message?: string; data?: unknown } }
      if (!response.ok || body.error || typeof body.result !== 'string' || !body.result) {
        const details = body.error?.data === undefined ? '' : `; ${JSON.stringify(body.error.data)}`
        throw new BridgeError(`Solana RPC sendTransaction failed: ${body.error?.message ?? `HTTP ${response.status}`}${details}`)
      }
      return { signature: body.result }
    },
  }

  let walletClient: SolanaWalletClient | undefined
  if (config.account?.type === 'wallet') {
    const walletAccount = config.account
    const feature = walletAccount.wallet.features[SOLANA_SIGN_AND_SEND_TRANSACTION_FEATURE] as
      | SolanaSignAndSendTransactionFeature
      | undefined
    if (!feature) throw new BridgeError(`Connected wallet does not expose the '${SOLANA_SIGN_AND_SEND_TRANSACTION_FEATURE}' feature`)
    walletClient = {
      getAddress: async () => walletAccount.account.address,
      sendTransaction: async (transaction) => {
        const [output] = await feature.signAndSendTransaction({
          transaction,
          account: walletAccount.account,
          chain: walletAccount.chain,
        })
        if (!output) throw new BridgeError('Wallet returned no signAndSendTransaction result')
        return { signature: bs58.encode(output.signature) }
      },
    }
  } else if (config.account?.type === 'local') {
    let signerPromise: ReturnType<typeof createSigner> | undefined
    const create = () => signerPromise ??= createSigner(config.account!.type === 'local'
      ? config.account!.secretKeyBytes
      : new Uint8Array())
    walletClient = {
      getAddress: async () => (await create()).address,
      sendTransaction: async (wireTransaction) => {
        const kit = await loadKit()
        const signer = await create()
        const transaction = kit.getTransactionDecoder().decode(wireTransaction)
        const signed = await kit.partiallySignTransaction([signer.keyPair], transaction)
        return publicClient.sendTransaction(new Uint8Array(kit.getTransactionEncoder().encode(signed)))
      },
    }
  }
  return { family: 'solana', publicClient, walletClient }
}

async function createSigner(secretKeyBytes: Uint8Array) {
  const kit = await loadKit()
  return kit.createKeyPairSignerFromBytes(secretKeyBytes)
}
