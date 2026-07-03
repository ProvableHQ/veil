/**
 * @veil/wallet-adapter
 *
 * Wraps @provablehq/aleo-wallet-adaptor-core into veil's
 * Account and Transport interfaces.
 *
 * Usage with any wallet adapter (Leo, Puzzle, Fox, Shield):
 *
 *   import { LeoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-leo'
 *   import { fromWalletAdapter } from '@veil/wallet-adapter'
 *   import { createWalletClient, http, fallback } from '@veil/core'
 *
 *   const leoWallet = new LeoWalletAdapter()
 *   await leoWallet.connect(Network.MAINNET, DecryptPermission.UponRequest)
 *
 *   const { account, transport } = fromWalletAdapter(leoWallet)
 *
 *   const walletClient = createWalletClient({
 *     account,
 *     transport: fallback([transport, http('https://api.provable.com/v2')]),
 *   })
 */

import { custom } from '@veil/core'
import type { Network, RpcAccount, Transport, TransactionStatusResponse, TxHistoryResult } from '@veil/core'

// Import the real types from the Provable ecosystem
import type { TransactionOptions, TransactionInput } from '@provablehq/aleo-types'
import type { AleoDeployment } from '@provablehq/aleo-wallet-standard'
import type { RecordStatusFilter } from '@veil/core'
import type { BaseAleoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-core'

// Re-export useful types so consumers don't need extra imports
export type { TransactionOptions } from '@provablehq/aleo-types'
export type { Network, TransactionStatusResponse, TxHistoryResult } from '@veil/core'
export type { BaseAleoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-core'

// Re-export the privacy-feature types (Veil mirrors) so consumers can import them
// from the wallet-adapter boundary alongside fromWalletAdapter.
//
// The upstream error classes (WalletAddressWithheldError, etc.) are deliberately
// NOT re-exported here: @provablehq/aleo-wallet-adaptor-core is an OPTIONAL peer
// dependency, and a value re-export would compile to a static runtime import,
// breaking consumers who use fromWalletAdapter without installing -core. Consumers
// that need to catch those classes import them from
// @provablehq/aleo-wallet-adaptor-core directly.
export type {
  TransactionInput,
  InputRequest,
  RecordFilters,
  RecordView,
  ConnectOptions,
  RecordAccessGrant,
  AlgorithmGrant,
} from '@veil/core'

// --------------------------------------------------------------------------
// Wallet adapter interface — matches BaseAleoWalletAdapter from
// @provablehq/aleo-wallet-adaptor-core
// --------------------------------------------------------------------------

/**
 * The post-connect subset of the Provable wallet standard's `WalletAdapter`
 * interface — covers the methods veil invokes after a wallet is already
 * connected. `connect` and `disconnect` are deliberately omitted; consumers
 * call those on the adapter directly before passing it to `fromWalletAdapter`.
 *
 * All standard-conforming adapters (Leo, Puzzle, Fox, Shield) satisfy this
 * shape because their classes implement every method declared here.
 * Implementations that don't support a given feature should throw at runtime
 * (the standard's `WalletFeatureNotAvailableError` contract).
 */
export interface AleoWalletAdapter {
  /** The connected account. */
  account?: { address: string; viewKey?: string; privateKey?: string }

  /** Whether the wallet is currently connected. */
  connected: boolean

  /** The wallet's currently selected network. May be null before connect. */
  network: Network | null

  /** Sign an arbitrary message — returns raw signature bytes. */
  signMessage(message: Uint8Array): Promise<Uint8Array>

  /** Execute a program function — returns temporary transaction id. */
  executeTransaction(options: TransactionOptions): Promise<{ transactionId: string }>

  /** Deploy a program — returns temporary transaction id. */
  executeDeployment(deployment: AleoDeployment): Promise<{ transactionId: string }>

  /** Get the status of a submitted transaction. */
  transactionStatus(transactionId: string): Promise<TransactionStatusResponse>

  /**
   * Decrypt a record ciphertext using the wallet's view key.
   *
   * Throws `WalletAddressWithheldError` when the connection was made with
   * `readAddress: false` — decryption would reveal the address.
   */
  decrypt(
    cipherText: string,
    tpk?: string,
    programId?: string,
    functionName?: string,
    index?: number,
  ): Promise<string>

  /**
   * Request records for a program.
   *
   * Throws `WalletAddressWithheldError` when the connection was made with
   * `readAddress: false`.
   */
  requestRecords(
    program: string,
    includePlaintext: boolean,
    statusFilter?: RecordStatusFilter,
  ): Promise<unknown[]>

  /**
   * Get transition view keys for a transaction.
   *
   * Throws `WalletAddressWithheldError` when the connection was made with
   * `readAddress: false`.
   */
  transitionViewKeys(transactionId: string): Promise<string[]>

  /** Switch the connected network. May throw if the wallet doesn't support it. */
  switchNetwork(network: Network): Promise<void>

  /**
   * Get transaction history for a program. May throw if the wallet doesn't support it.
   *
   * Throws `WalletAddressWithheldError` when the connection was made with
   * `readAddress: false`.
   */
  requestTransactionHistory(program: string): Promise<TxHistoryResult>

  /**
   * List the derived-input algorithms this wallet supports. Empty if none.
   *
   * Optional: wallets that predate the privacy feature omit it, in which case
   * the transport reports no supported algorithms.
   */
  algorithmsSupported?(): Promise<string[]>
}

/**
 * Union of Veil's minimal interface and the real BaseAleoWalletAdapter.
 * All public functions accept either shape — duck-typing handles
 * the differences since both expose the same method signatures.
 */
export type AnyWalletAdapter = AleoWalletAdapter | BaseAleoWalletAdapter

// --------------------------------------------------------------------------
// Account adapter
// --------------------------------------------------------------------------

/**
 * Creates an veil RpcAccount from a connected wallet adapter.
 *
 * The adapter must be connected (adapter.account must exist).
 * Sign operations are delegated to the wallet.
 */
export function rpcAccountFromAdapter(adapter: AnyWalletAdapter): RpcAccount {
  if (!adapter.account) {
    throw new Error(
      'Wallet adapter is not connected. Call adapter.connect() before creating an account.',
    )
  }

  const address = adapter.account.address

  return {
    type: 'rpc',
    address,
    sign: (message: Uint8Array) => adapter.signMessage(message),
    signMessage: (message: Uint8Array) => adapter.signMessage(message),
  }
}

// --------------------------------------------------------------------------
// Transport adapter
// --------------------------------------------------------------------------

/**
 * Creates an veil custom transport that routes wallet-specific
 * operations through the adapter.
 *
 * This transport handles:
 * - executeTransaction → adapter.executeTransaction()
 * - deployProgram → adapter.executeDeployment()
 * - signMessage → adapter.signMessage()
 * - decrypt → adapter.decrypt()
 * - requestRecords → adapter.requestRecords()
 * - transactionStatus → adapter.transactionStatus()
 * - transitionViewKeys → adapter.transitionViewKeys()
 *
 * Read operations (getBlock, getBalance, etc.) are NOT handled — pair
 * with http() via fallback() for full coverage:
 *
 *   fallback([transportFromAdapter(adapter), http(url)])
 */
export function transportFromAdapter(adapter: AnyWalletAdapter): Transport<'custom'> {
  return custom({
    key: 'walletAdapter',
    name: 'Wallet Adapter Transport',
    request: async ({ method, params }) => {
      const p = params as Record<string, unknown> | undefined

      switch (method) {
        case 'executeTransaction': {
          const options: TransactionOptions = {
            program: p?.programName as string,
            function: p?.functionName as string,
            // Inputs may be Aleo-encoded strings or InputRequest objects the wallet
            // fulfils (address/record/derived); pass them through untouched.
            inputs: p?.inputs as TransactionInput[],
            privateFee: (p?.privateFee as boolean) ?? false,
          }
          if (p?.imports != null) {
            options.imports = p.imports as string[]
          }
          const result = await adapter.executeTransaction(options)
          return result.transactionId
        }

        case 'deployProgram': {
          // The wallet-standard `AleoDeployment` shape requires `priorityFee`,
          // but Veil's user-facing API treats fees as auto-estimated; pass 0 so
          // the wallet uses its own default.
          const deployment: AleoDeployment = {
            program: p?.program as string,
            address: adapter.account?.address ?? '',
            priorityFee: 0,
            privateFee: (p?.privateFee as boolean) ?? false,
          }
          const result = await adapter.executeDeployment(deployment)
          return result.transactionId
        }

        case 'signMessage': {
          return adapter.signMessage(p?.message as Uint8Array)
        }

        case 'decrypt':
          return adapter.decrypt(
            p?.cipherText as string,
            p?.tpk as string | undefined,
            p?.programId as string | undefined,
            p?.functionName as string | undefined,
            p?.index as number | undefined,
          )

        case 'requestRecords':
          return adapter.requestRecords(
            p?.program as string,
            (p?.includePlaintext as boolean) ?? true,
            p?.statusFilter as RecordStatusFilter | undefined,
          )

        case 'transactionStatus': {
          return adapter.transactionStatus(p?.transactionId as string)
        }

        case 'getTransitionViewKeys': {
          return adapter.transitionViewKeys(p?.id as string)
        }

        case 'algorithmsSupported': {
          return adapter.algorithmsSupported ? adapter.algorithmsSupported() : []
        }

        case 'switchNetwork': {
          // Cast: BaseAleoWalletAdapter expects @provablehq/aleo-types' Network
          // enum, AleoWalletAdapter expects @veil/core's string-union Network.
          // Runtime values are identical strings.
          return (adapter.switchNetwork as (n: unknown) => Promise<void>)(p?.network)
        }

        case 'requestTransactionHistory': {
          return adapter.requestTransactionHistory(p?.program as string)
        }

        case 'getChainId': {
          return adapter.network
        }

        default:
          throw new Error(
            `Wallet adapter transport does not handle method "${method}". ` +
            'Use fallback([transportFromAdapter(adapter), http(url)]) for read methods.',
          )
      }
    },
  })
}

// --------------------------------------------------------------------------
// Convenience
// --------------------------------------------------------------------------

/**
 * Creates both an veil account and transport from a connected
 * wallet adapter. This is the primary entry point.
 *
 *   const { account, transport } = fromWalletAdapter(leoWallet)
 *   const client = createWalletClient({ account, transport })
 */
export function fromWalletAdapter(adapter: AnyWalletAdapter): {
  account: RpcAccount
  transport: Transport<'custom'>
} {
  return {
    account: rpcAccountFromAdapter(adapter),
    transport: transportFromAdapter(adapter),
  }
}
