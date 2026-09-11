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
 * @property getBlockHeight Reads the current block height used to detect transaction expiry.
 * @property isBlockhashValid Reports whether a recent blockhash remains valid at confirmed commitment.
 * @property getBalance Reads an account's lamport balance.
 * @property getAccountData Reads an account's raw data, or `null` when the account does not exist.
 * @property getFeeForMessage Reads the network fee for a compiled transaction message, in lamports.
 * @property getMinimumBalanceForRentExemption Reads the rent-exempt minimum for an account data length, in lamports.
 * @property getSignatureStatus Reads a submitted transaction's confirmation state, or `null` when the signature is unknown to the node.
 * @property getTransactionLogs Reads a confirmed transaction's program logs, or `null` when the transaction is not found.
 */
export type SolanaRpcClient = {
  getLatestBlockhash: () => Promise<{ blockhash: string; lastValidBlockHeight: bigint }>
  getBlockHeight: () => Promise<bigint>
  isBlockhashValid: (blockhash: string) => Promise<boolean>
  getBalance: (address: string) => Promise<bigint>
  getAccountData: (address: string) => Promise<Uint8Array | null>
  getFeeForMessage: (message: Uint8Array) => Promise<bigint>
  getMinimumBalanceForRentExemption: (dataLength: number) => Promise<bigint>
  getSignatureStatus: (signature: string) => Promise<SolanaSignatureConfirmationStatus | null>
  getTransactionLogs: (signature: string) => Promise<string[] | null>
}

/** Describes the result and error fields returned by a Solana JSON-RPC request. */
type JsonRpcResponse<T> = {
  result?: T
  error?: { code?: number; message?: string }
}

/** Describes the `{ context, value }` envelope Solana uses for most read results. */
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
 * Creates the Solana network reader used to quote and follow Hyperlane transfers.
 *
 * Every method sends one JSON-RPC request through the supplied transport and
 * validates the response before returning it. No method requests a wallet
 * signature or submits a transaction.
 *
 * @param config Solana JSON-RPC endpoint and optional Fetch API replacement. The transport defaults to `globalThis.fetch`.
 * @returns Network reads for blockhashes, balances, fees, rent, accounts, signatures, and logs.
 *
 * @example
 * const rpc = createSolanaRpcClient({ url: 'https://api.mainnet-beta.solana.com' })
 * const { blockhash } = await rpc.getLatestBlockhash()
 */
export function createSolanaRpcClient(config: SolanaRpcConfig): SolanaRpcClient {
  async function call<T>(method: string, params: unknown[]): Promise<T> {
    // This is the single trust boundary for every Solana read: distinguish
    // transport failure, invalid JSON, JSON-RPC error, and a missing result so
    // operators can tell endpoint problems from transaction failure.
    const transport = config.transport ?? globalThis.fetch
    const response = await transport(config.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      cache: 'no-store',
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
    // Solana emits these quantities as JSON numbers. Convert only safe,
    // non-negative integers before later arithmetic switches to bigint.
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
        [{ commitment: 'confirmed' }],
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

    async isBlockhashValid(blockhash) {
      const result = await call<unknown>('isBlockhashValid', [blockhash, { commitment: 'confirmed' }])
      const value = contextualValue<unknown>('isBlockhashValid', result)
      if (typeof value !== 'boolean') {
        throw new BridgeError('Solana RPC isBlockhashValid returned an invalid result')
      }
      return value
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
      // Search historical slots as well as the node's recent-status cache;
      // recovery may run long after the original process submitted the transfer.
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
