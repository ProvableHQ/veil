import { BridgeError } from '../errors/bridgeErrors.js'
import bs58 from 'bs58'
import { loadKit } from '../solana/kit.js'
import { createSolanaRpcClient, type SolanaRpcClient } from '../solana/rpc.js'
import type { SolanaRpcHttpTransport } from '../types/solana.js'

const SOLANA_SIGN_AND_SEND_TRANSACTION_FEATURE = 'solana:signAndSendTransaction'

/** Provides Solana's public mainnet endpoint as the default for examples and low-volume reads. */
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

/** Stores an HTTP endpoint or custom JSON-RPC function without contacting Solana. */
export type SolanaTransport =
  | { type: 'http'; url: string; fetch?: SolanaRpcHttpTransport | undefined }
  | { type: 'custom'; request: SolanaRequest }

/** Selects whether a Wallet Standard account or application-held key authorizes transactions. */
export type SolanaAccount =
  | {
      type: 'wallet'
      wallet: { features: Record<string, unknown> }
      account: { address: string; publicKey: Uint8Array }
      chain: string
    }
  | { type: 'local'; secretKeyBytes: Uint8Array }

/**
 * Configures Solana network and optional wallet access for one named bridge chain.
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
 * @property family Prevents this client from being used for an EVM or Aleo route stored under the wrong chain identifier.
 * @property publicClient Read and broadcast capability.
 * @property walletClient Optional signing capability.
 */
export type SolanaClient = {
  family: 'solana'
  publicClient: SolanaPublicClient
  walletClient?: SolanaWalletClient | undefined
}

/**
 * Defines the Solana JSON-RPC endpoint used when a bridge action reads or submits.
 *
 * Creating the transport does not contact the endpoint.
 *
 * @param url Solana JSON-RPC endpoint contacted by the resulting client.
 * @param options Optional Fetch API implementation. Defaults to `globalThis.fetch` when the client is created.
 * @returns Deferred HTTP configuration accepted by `createSolanaClient`.
 * @example const transport = solanaHttp('https://api.mainnet-beta.solana.com')
 */
export function solanaHttp(url: string, options: SolanaHttpOptions = {}): SolanaTransport {
  return { type: 'http', url, fetch: options.fetch }
}

/**
 * Defines Solana network access through an application-supplied JSON-RPC function.
 *
 * Creating the transport does not call the request function.
 *
 * @param request Function that sends JSON-RPC methods when a bridge action needs network access.
 * @returns Deferred custom transport configuration accepted by `createSolanaClient`.
 * @example const transport = solanaCustom((method, params) => rpc.request(method, params))
 */
export function solanaCustom(request: SolanaRequest): SolanaTransport {
  return { type: 'custom', request }
}

/**
 * Selects a Wallet Standard account to authorize Solana bridge transactions.
 *
 * The wallet retains custody of the account and controls signing and broadcast.
 * This helper does not connect to the wallet or request a signature.
 *
 * @param params Wallet, selected account, and Wallet Standard chain identifier used for later authorization.
 * @returns Deferred wallet configuration accepted by `createSolanaClient`.
 * @example const account = solanaWallet({ wallet, account: wallet.accounts[0], chain: 'solana:mainnet' })
 */
export function solanaWallet(params: Omit<Extract<SolanaAccount, { type: 'wallet' }>, 'type'>): SolanaAccount {
  return { type: 'wallet', ...params }
}

/**
 * Selects an application-held Solana keypair for unattended bridge transactions.
 *
 * The keypair signs on the caller's device or server. This helper copies the
 * key bytes but does not contact Solana or submit a transaction; the application
 * remains responsible for keeping the key secret.
 *
 * @param secretKeyBytes Secret Solana CLI-format 64-byte keypair held by the application.
 * @returns Deferred local signing configuration accepted by `createSolanaClient`.
 * @throws BridgeError When the key is not exactly 64 bytes.
 * @example const account = solanaKeyPair(secretKeyBytes)
 */
export function solanaKeyPair(secretKeyBytes: Uint8Array): SolanaAccount {
  if (secretKeyBytes.length !== 64) throw new BridgeError('Solana secret key must contain exactly 64 bytes')
  return { type: 'local', secretKeyBytes: new Uint8Array(secretKeyBytes) }
}

/**
 * Creates the Solana client used to read bridge state and optionally authorize transactions.
 *
 * Construction wires the transport and optional account without making an RPC
 * request. Read-only actions need only the transport; fund-moving actions also
 * require a Wallet Standard account or local keypair.
 *
 * @param config Solana network access and optional wallet authorization supplied by the application.
 * @returns Solana read, broadcast, and optional wallet capabilities used by bridge actions.
 * @throws BridgeError When the transport is absent.
 * @example const client = createSolanaClient({ transport: solanaHttp(rpcUrl), account: solanaKeyPair(key) })
 */
export function createSolanaClient(
  config: SolanaClientConfig,
): SolanaClient {
  if (!config.transport) throw new BridgeError('Solana client requires a transport')
  return materializeSolanaClient(config, globalThis.fetch)
}

/** Normalizes HTTP, custom RPC, Wallet Standard, and local-key inputs behind the bridge's Solana capabilities. */
function materializeSolanaClient(
  config: SolanaClientConfig,
  defaultFetch: SolanaRpcHttpTransport,
): SolanaClient {
  const transportDefinition = config.transport
  // Adapt custom method/parameter transports to the fetch-like boundary shared
  // by the RPC reader, keeping response validation in one implementation.
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
      // Solana's RPC accepts the complete wire transaction as base64. This path
      // never signs; callers must supply all required signatures first.
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
    // Wallet Standard combines authorization and broadcast. Preserve that
    // boundary because browser wallets do not expose private signing keys.
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
    // Import the secret key lazily so creating a read/write client performs no
    // cryptographic setup until an address or signature is requested.
    let signerPromise: ReturnType<typeof createSigner> | undefined
    const create = () => signerPromise ??= createSigner(config.account!.type === 'local'
      ? config.account!.secretKeyBytes
      : new Uint8Array())
    walletClient = {
      getAddress: async () => (await create()).address,
      sendTransaction: async (wireTransaction) => {
        // Protocol code may have already added ephemeral signer signatures.
        // Partial signing adds the fee payer without discarding those bytes.
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
