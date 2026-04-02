/**
 * @aleo-viem/wallet-adapter
 *
 * Wraps @provablehq/aleo-wallet-adaptor-core into aleo-viem's
 * Account and Transport interfaces.
 *
 * Usage with any wallet adapter (Leo, Puzzle, Fox, Shield):
 *
 *   import { LeoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-leo'
 *   import { fromWalletAdapter } from '@aleo-viem/wallet-adapter'
 *   import { createWalletClient, http, fallback } from '@aleo-viem/core'
 *
 *   const leoWallet = new LeoWalletAdapter()
 *   await leoWallet.connect(Network.MAINNET, DecryptPermission.UponRequest)
 *
 *   const { account, transport } = fromWalletAdapter(leoWallet)
 *
 *   const walletClient = createWalletClient({
 *     account,
 *     transport: fallback([transport, http('https://api.explorer.provable.com/v1')]),
 *   })
 */

import { custom } from '@aleo-viem/core'
import type { RpcAccount, Transport } from '@aleo-viem/core'

// Import the real types from the Provable ecosystem
import type { TransactionOptions, TransactionStatusResponse } from '@provablehq/aleo-types'
import type { AleoDeployment } from '@provablehq/aleo-wallet-standard'

// Re-export useful types so consumers don't need extra imports
export type { TransactionOptions, TransactionStatusResponse } from '@provablehq/aleo-types'
export { Network } from '@provablehq/aleo-types'

// --------------------------------------------------------------------------
// Wallet adapter interface — matches BaseAleoWalletAdapter from
// @provablehq/aleo-wallet-adaptor-core
// --------------------------------------------------------------------------

/**
 * The interface any Aleo wallet adapter must implement.
 * Matches the shape of BaseAleoWalletAdapter from
 * @provablehq/aleo-wallet-adaptor-core without requiring it as a dependency.
 *
 * All official adapters (Leo, Puzzle, Fox, Shield) implement this.
 */
export interface AleoWalletAdapter {
  /** The connected account — available after connect() */
  account?: { address: string; viewKey?: string; privateKey?: string }

  /** Whether the wallet is currently connected */
  connected: boolean

  /** Sign an arbitrary message — returns raw signature bytes */
  signMessage(message: Uint8Array): Promise<Uint8Array>

  /** Execute a program function — returns temporary transaction ID */
  executeTransaction(options: TransactionOptions): Promise<{ transactionId: string }>

  /** Deploy a program — returns temporary transaction ID */
  executeDeployment(deployment: AleoDeployment): Promise<{ transactionId: string }>

  /** Get the status of a submitted transaction */
  transactionStatus(transactionId: string): Promise<TransactionStatusResponse>

  /** Decrypt a record ciphertext using the wallet's view key */
  decrypt(
    cipherText: string,
    tpk?: string,
    programId?: string,
    functionName?: string,
    index?: number,
  ): Promise<string>

  /** Request records for a program */
  requestRecords(program: string, includePlaintext: boolean): Promise<unknown[]>

  /** Get transition view keys for a transaction */
  transitionViewKeys(transactionId: string): Promise<string[]>
}

// --------------------------------------------------------------------------
// Account adapter
// --------------------------------------------------------------------------

/**
 * Creates an aleo-viem RpcAccount from a connected wallet adapter.
 *
 * The adapter must be connected (adapter.account must exist).
 * Sign operations are delegated to the wallet.
 */
export function rpcAccountFromAdapter(adapter: AleoWalletAdapter): RpcAccount {
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
 * Creates an aleo-viem custom transport that routes wallet-specific
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
export function transportFromAdapter(adapter: AleoWalletAdapter): Transport<'custom'> {
  return custom({
    key: 'walletAdapter',
    name: 'Wallet Adapter Transport',
    request: async ({ method, params }) => {
      const p = params as Record<string, unknown> | undefined

      switch (method) {
        case 'executeTransaction': {
          const result = await adapter.executeTransaction({
            program: p?.programName as string,
            function: p?.functionName as string,
            inputs: p?.inputs as string[],
            fee: Number(p?.fee ?? 0),
            privateFee: (p?.privateFee as boolean) ?? false,
          })
          return result.transactionId
        }

        case 'deployProgram': {
          const result = await adapter.executeDeployment({
            program: p?.program as string,
            fee: Number(p?.fee ?? 0),
          } as AleoDeployment)
          return result.transactionId
        }

        case 'signMessage': {
          return adapter.signMessage(p?.message as Uint8Array)
        }

        case 'decrypt':
          return adapter.decrypt(
            p?.ciphertext as string,
            p?.tpk as string | undefined,
            p?.programId as string | undefined,
            p?.functionName as string | undefined,
          )

        case 'requestRecords':
          return adapter.requestRecords(p?.program as string, true)

        case 'transactionStatus': {
          return adapter.transactionStatus(p?.transactionId as string)
        }

        case 'getTransitionViewKeys': {
          return adapter.transitionViewKeys(p?.id as string)
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
 * Creates both an aleo-viem account and transport from a connected
 * wallet adapter. This is the primary entry point.
 *
 *   const { account, transport } = fromWalletAdapter(leoWallet)
 *   const client = createWalletClient({ account, transport })
 */
export function fromWalletAdapter(adapter: AleoWalletAdapter): {
  account: RpcAccount
  transport: Transport<'custom'>
} {
  return {
    account: rpcAccountFromAdapter(adapter),
    transport: transportFromAdapter(adapter),
  }
}
