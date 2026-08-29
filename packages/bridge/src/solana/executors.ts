import bs58 from 'bs58'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { SolanaBridgeExecutor, SolanaRpcConfig } from '../types/solana.js'
import { loadKit } from './kit.js'

const SOLANA_SIGN_AND_SEND_TRANSACTION_FEATURE = 'solana:signAndSendTransaction'

/**
 * Shape of the Wallet Standard `solana:signAndSendTransaction` feature.
 *
 * @property signAndSendTransaction Signs and broadcasts a wire-format transaction for the given account and chain, returning the transaction's on-chain signature.
 */
type SolanaSignAndSendTransactionFeature = {
  signAndSendTransaction: (input: {
    transaction: Uint8Array
    account: { address: string; publicKey: Uint8Array }
    chain: string
  }) => Promise<readonly { signature: Uint8Array }[]>
}

/**
 * Builds a Solana bridge executor backed by a connected wallet's Wallet
 * Standard `solana:signAndSendTransaction` feature.
 *
 * Never imports `@solana/kit`; every call is delegated to the wallet, which
 * signs and submits the transaction itself, so this factory hits the wallet
 * but never the network directly. Applies to browser dApps and other
 * integrations where the private key never leaves the connected wallet.
 *
 * @param params.wallet Wallet Standard wallet object exposing `features`; must contain `'solana:signAndSendTransaction'`.
 * @param params.account Connected account whose address is returned by `getAddress` and attached to each wallet call.
 * @param params.chain Wallet Standard chain identifier (for example `'solana:mainnet'`) passed through to the feature.
 * @returns A {@link SolanaBridgeExecutor} that reads the account's address and delegates signing and submission to the wallet.
 * @throws BridgeError When the wallet does not expose the `solana:signAndSendTransaction` feature.
 *
 * @example
 * const executor = solanaExecutorFromWalletAccount({
 *   wallet: connectedWallet,
 *   account: connectedWallet.accounts[0],
 *   chain: 'solana:mainnet',
 * })
 */
export function solanaExecutorFromWalletAccount(params: {
  wallet: { features: Record<string, unknown> }
  account: { address: string; publicKey: Uint8Array }
  chain: string
}): SolanaBridgeExecutor {
  const feature = params.wallet.features[SOLANA_SIGN_AND_SEND_TRANSACTION_FEATURE] as
    | SolanaSignAndSendTransactionFeature
    | undefined
  if (!feature) {
    throw new BridgeError(
      `Connected wallet does not expose the '${SOLANA_SIGN_AND_SEND_TRANSACTION_FEATURE}' feature`,
    )
  }
  return {
    getAddress: async () => params.account.address,
    signAndSendTransaction: async (wireTransaction) => {
      const [output] = await feature.signAndSendTransaction({
        transaction: wireTransaction,
        account: params.account,
        chain: params.chain,
      })
      if (!output) throw new BridgeError('Wallet returned no signAndSendTransaction result')
      return { signature: bs58.encode(output.signature) }
    },
  }
}

/**
 * Builds a Solana bridge executor from a raw Ed25519 secret key.
 *
 * Lazily loads the optional `@solana/kit` peer dependency (via {@link loadKit})
 * to derive the signer and to decode, sign, and re-encode the wire
 * transaction, then submits the signed transaction directly over Solana
 * JSON-RPC using `params.rpc`. Applies to bots, scripts, and servers that hold
 * the private key locally rather than delegating to a connected wallet.
 *
 * @param params.secretKeyBytes 64-byte Ed25519 secret key: the 32-byte private key followed by its 32-byte public key.
 * @param params.rpc Solana JSON-RPC endpoint (and optional transport) used to submit the signed transaction.
 * @returns A {@link SolanaBridgeExecutor} whose address is derived from the secret key.
 * @throws BridgeError When `@solana/kit` is not installed, or when the RPC endpoint rejects the `sendTransaction` call.
 *
 * @example
 * const executor = await solanaExecutorFromKeyPair({
 *   secretKeyBytes,
 *   rpc: { url: 'https://api.mainnet-beta.solana.com' },
 * })
 */
export async function solanaExecutorFromKeyPair(params: {
  secretKeyBytes: Uint8Array
  rpc: SolanaRpcConfig
}): Promise<SolanaBridgeExecutor> {
  const kit = await loadKit()
  const signer = await kit.createKeyPairSignerFromBytes(params.secretKeyBytes)
  return {
    getAddress: async () => signer.address,
    signAndSendTransaction: async (wireTransaction) => {
      const transaction = kit.getTransactionDecoder().decode(wireTransaction)
      const signedTransaction = await kit.partiallySignTransaction([signer.keyPair], transaction)
      const wireBase64 = kit.getBase64EncodedWireTransaction(signedTransaction)
      const transport = params.rpc.transport ?? globalThis.fetch
      const response = await transport(params.rpc.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [wireBase64, { encoding: 'base64' }],
        }),
      })
      if (!response.ok) {
        throw new BridgeError(`Solana RPC sendTransaction failed with HTTP status ${response.status}`)
      }
      const body = (await response.json()) as { result?: string; error?: { message?: string } }
      if (body.error || typeof body.result !== 'string') {
        throw new BridgeError(
          `Solana RPC sendTransaction returned an error: ${body.error?.message ?? 'unknown error'}`,
        )
      }
      return { signature: body.result }
    },
  }
}
