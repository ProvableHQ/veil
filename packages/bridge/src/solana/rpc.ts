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
  getBlockHeight: () => Promise<bigint>
  getBalance: (address: string) => Promise<bigint>
  getAccountData: (address: string) => Promise<Uint8Array | null>
  getFeeForMessage: (message: Uint8Array) => Promise<bigint>
  getMinimumBalanceForRentExemption: (dataLength: number) => Promise<bigint>
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
 * Every method sends one POST request through `config.transport` (defaulting
 * to `globalThis.fetch`) and hits the network; none of them are pure.
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
    let rawBody: unknown
    try {
      rawBody = await response.json()
    } catch (error) {
      throw new BridgeError(`Solana RPC ${method} returned invalid JSON`, { cause: error })
    }
    if (!rawBody || typeof rawBody !== 'object') {
      throw new BridgeError(`Solana RPC ${method} returned an invalid JSON-RPC response`)
    }
    const body = rawBody as JsonRpcResponse<T>
    if (body.error) {
      throw new BridgeError(`Solana RPC ${method} returned a JSON-RPC error: ${body.error.message ?? 'unknown error'}`, {
        cause: body.error,
      })
    }
    if (!Object.prototype.hasOwnProperty.call(body, 'result') || body.result === undefined) {
      throw new BridgeError(`Solana RPC ${method} returned an invalid result envelope`)
    }
    return body.result as T
  }

  function integer(method: string, value: unknown): bigint {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new BridgeError(`Solana RPC ${method} returned an invalid result`)
    }
    return BigInt(value)
  }

  function contextualValue<T>(method: string, result: unknown): T {
    if (!result || typeof result !== 'object' || !Object.prototype.hasOwnProperty.call(result, 'value')) {
      throw new BridgeError(`Solana RPC ${method} returned an invalid contextual result`)
    }
    return (result as ContextualResult<T>).value
  }

  return {
    async getLatestBlockhash() {
      const result = await call<unknown>(
        'getLatestBlockhash',
        [],
      )
      const value = contextualValue<{ blockhash: string; lastValidBlockHeight: number }>('getLatestBlockhash', result)
      if (!value || typeof value.blockhash !== 'string' || !value.blockhash) {
        throw new BridgeError('Solana RPC getLatestBlockhash returned an invalid result')
      }
      return { blockhash: value.blockhash, lastValidBlockHeight: integer('getLatestBlockhash', value.lastValidBlockHeight) }
    },

    async getBlockHeight() {
      return integer('getBlockHeight', await call<unknown>('getBlockHeight', []))
    },

    async getBalance(address) {
      const value = contextualValue<unknown>('getBalance', await call<unknown>('getBalance', [address]))
      return integer('getBalance', value)
    },

    async getFeeForMessage(message) {
      const base64 = btoa(String.fromCharCode(...message))
      const result = await call<unknown>('getFeeForMessage', [base64, { commitment: 'confirmed' }])
      return integer('getFeeForMessage', contextualValue('getFeeForMessage', result))
    },

    async getMinimumBalanceForRentExemption(dataLength) {
      if (!Number.isSafeInteger(dataLength) || dataLength < 0) {
        throw new BridgeError('Solana rent data length must be a non-negative integer')
      }
      return integer('getMinimumBalanceForRentExemption', await call<unknown>('getMinimumBalanceForRentExemption', [dataLength]))
    },

    async getAccountData(address) {
      const result = await call<unknown>('getAccountInfo', [
        address,
        { encoding: 'base64' },
      ])
      const value = contextualValue<{ data: [string, string] } | null>('getAccountInfo', result)
      if (!value) return null
      if (!Array.isArray(value.data) || typeof value.data[0] !== 'string' || value.data[1] !== 'base64') {
        throw new BridgeError('Solana RPC getAccountInfo returned invalid base64 account data')
      }
      try {
        return decodeBase64(value.data[0])
      } catch (error) {
        throw new BridgeError('Solana RPC getAccountInfo returned invalid base64 account data', { cause: error })
      }
    },

    async getSignatureStatus(signature) {
      const result = await call<unknown>(
        'getSignatureStatuses',
        [[signature], { searchTransactionHistory: true }],
      )
      const value = contextualValue<({ err: unknown; confirmationStatus?: string } | null)[]>('getSignatureStatuses', result)
      if (!Array.isArray(value) || value.length !== 1) {
        throw new BridgeError('Solana RPC getSignatureStatuses returned an invalid result')
      }
      const status = value[0]
      if (!status) return null
      if (typeof status !== 'object' || !Object.prototype.hasOwnProperty.call(status, 'err')) {
        throw new BridgeError('Solana RPC getSignatureStatuses returned an invalid status')
      }
      if (status.err) return 'failed'
      if (status.confirmationStatus === undefined) return null
      if (!['processed', 'confirmed', 'finalized'].includes(status.confirmationStatus)) {
        throw new BridgeError(`Solana RPC getSignatureStatuses returned unsupported confirmation status: ${status.confirmationStatus}`)
      }
      return status.confirmationStatus as SolanaSignatureConfirmationStatus
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
      if (result === null) return null
      if (!result || typeof result !== 'object' || !Object.prototype.hasOwnProperty.call(result, 'meta')) {
        throw new BridgeError('Solana RPC getTransaction returned an invalid result')
      }
      const meta = result.meta
      if (!meta || typeof meta !== 'object' || !Object.prototype.hasOwnProperty.call(meta, 'logMessages')) {
        throw new BridgeError('Solana RPC getTransaction returned invalid metadata')
      }
      const logs = meta.logMessages
      if (logs !== null && (!Array.isArray(logs) || logs.some((line) => typeof line !== 'string'))) {
        throw new BridgeError('Solana RPC getTransaction returned invalid logs')
      }
      return logs ?? null
    },
  }
}
