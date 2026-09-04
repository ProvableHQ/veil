import { BridgeError } from '../errors/bridgeErrors.js'
import type { SolanaRpcConfig } from '../types/solana.js'

/**
 * Confirmation state Solana reports for a submitted transaction signature.
 *
 * `'failed'` is synthesized locally from a non-null `err` field on the
 * `getSignatureStatuses` result; Solana itself only ever reports a
 * `confirmationStatus`, never a failure status.
 */
type SolanaSignatureConfirmationStatus = 'processed' | 'confirmed' | 'finalized' | 'failed'

/**
 * Reads live Solana chain state needed to prepare, submit, and confirm a
 * Hyperlane Warp Route transfer.
 *
 * Every method hits the configured Solana JSON-RPC endpoint over the network;
 * none of them sign or submit a transaction.
 *
 * @property getLatestBlockhash Reads the current blockhash and the block height it remains valid through.
 * @property getBalance Reads an account's lamport balance.
 * @property getAccountData Reads an account's raw data, or `null` when the account does not exist.
 * @property getSignatureStatus Reads a submitted transaction's confirmation state, or `null` when the signature is unknown to the node.
 * @property getTransactionLogs Reads a confirmed transaction's program logs, or `null` when the transaction is not found.
 */
export type SolanaRpcReader = {
  getLatestBlockhash: () => Promise<{ blockhash: string; lastValidBlockHeight: bigint }>
  getBalance: (address: string) => Promise<bigint>
  getAccountData: (address: string) => Promise<Uint8Array | null>
  getSignatureStatus: (signature: string) => Promise<SolanaSignatureConfirmationStatus | null>
  getTransactionLogs: (signature: string) => Promise<string[] | null>
}

/** Shape of a Solana JSON-RPC response envelope, generic over the `result` payload. */
type JsonRpcResponse<T> = {
  result?: T
  error?: { code?: number; message?: string }
}

/** Shape of the `{ context, value }` envelope Solana wraps most read results in. */
type ContextualResult<T> = { value: T }

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * Builds a Solana JSON-RPC reader over a plain HTTP transport.
 *
 * Speaks JSON-RPC directly rather than depending on `@solana/kit`, so reads
 * are usable without the optional `@solana/kit` peer dependency the signing
 * path (`solanaExecutorFromKeyPair`) requires. Every method sends one POST
 * request through `config.transport` (defaulting to `globalThis.fetch`) and
 * hits the network; none of them are pure.
 *
 * @param config Solana JSON-RPC endpoint and optional transport override.
 * @returns A {@link SolanaRpcReader} bound to `config.url`.
 *
 * @example
 * const rpc = createSolanaRpcReader({ url: 'https://api.mainnet-beta.solana.com' })
 * const { blockhash } = await rpc.getLatestBlockhash()
 */
export function createSolanaRpcReader(config: SolanaRpcConfig): SolanaRpcReader {
  async function call<T>(method: string, params: unknown[]): Promise<T> {
    const transport = config.transport ?? globalThis.fetch
    const response = await transport(config.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    if (!response.ok) {
      throw new BridgeError(`Solana RPC ${method} request failed with HTTP status ${response.status}`, {
        cause: { status: response.status },
      })
    }
    const body = (await response.json()) as JsonRpcResponse<T>
    if (body.error) {
      throw new BridgeError(`Solana RPC ${method} returned a JSON-RPC error: ${body.error.message ?? 'unknown error'}`, {
        cause: body.error,
      })
    }
    return body.result as T
  }

  return {
    async getLatestBlockhash() {
      const { value } = await call<ContextualResult<{ blockhash: string; lastValidBlockHeight: number }>>(
        'getLatestBlockhash',
        [],
      )
      return { blockhash: value.blockhash, lastValidBlockHeight: BigInt(value.lastValidBlockHeight) }
    },

    async getBalance(address) {
      const { value } = await call<ContextualResult<number>>('getBalance', [address])
      return BigInt(value)
    },

    async getAccountData(address) {
      const { value } = await call<ContextualResult<{ data: [string, string] } | null>>('getAccountInfo', [
        address,
        { encoding: 'base64' },
      ])
      if (!value) return null
      const [base64] = value.data
      return decodeBase64(base64)
    },

    async getSignatureStatus(signature) {
      const { value } = await call<ContextualResult<({ err: unknown; confirmationStatus?: string } | null)[]>>(
        'getSignatureStatuses',
        [[signature]],
      )
      const status = value[0]
      if (!status) return null
      if (status.err) return 'failed'
      return (status.confirmationStatus as SolanaSignatureConfirmationStatus | undefined) ?? null
    },

    async getTransactionLogs(signature) {
      // Solana's JSON-RPC `getTransaction` defaults to `finalized` commitment
      // when none is given; a transaction that has only reached `confirmed`
      // then returns null even though it already landed, missing the
      // Hyperlane dispatch log. Request `confirmed` explicitly.
      const result = await call<{ meta: { logMessages: string[] | null } | null } | null>('getTransaction', [
        signature,
        { maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
      ])
      return result?.meta?.logMessages ?? null
    },
  }
}
