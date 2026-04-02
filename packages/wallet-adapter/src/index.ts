/**
 * @aleo-viem/wallet-adapter
 *
 * Wraps the Aleo wallet adapter standard (@provablehq/aleo-wallet-adaptor-core)
 * into aleo-viem's Account and Transport interfaces.
 *
 * Usage with Leo Wallet:
 *   import { LeoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-leo'
 *   import { fromWalletAdapter } from '@aleo-viem/wallet-adapter'
 *   import { createWalletClient, http, fallback } from '@aleo-viem/core'
 *
 *   const leoWallet = new LeoWalletAdapter()
 *   await leoWallet.connect(DecryptPermission.UponRequest, WalletAdapterNetwork.Mainnet)
 *
 *   const { account, transport } = fromWalletAdapter(leoWallet)
 *
 *   // Wallet transport handles signing/execution, http handles reads
 *   const walletClient = createWalletClient({
 *     account,
 *     transport: fallback([transport, http('https://api.provable.com/v2')]),
 *   })
 */

import { custom } from '@aleo-viem/core'
import type { RpcAccount, Transport } from '@aleo-viem/core'

// --------------------------------------------------------------------------
// Wallet adapter interface
// --------------------------------------------------------------------------
// Matches the shape of @provablehq/aleo-wallet-adaptor-core SignerWalletAdapter
// without importing it directly (interface-first).

export type DecryptPermission = 'NoDecrypt' | 'UponRequest' | 'AutoDecrypt' | 'OnChainHistory'

export type WalletAdapterNetwork = 'mainnet' | 'testnet' | 'localnet'

/** Aleo transaction structure as expected by wallet adapters */
export type AleoTransaction = {
  address: string
  chainId: string
  transitions: Array<{
    program: string
    functionName: string
    inputs: unknown[]
  }>
  fee: number
  privateFee: boolean
}

/** Aleo deployment structure as expected by wallet adapters */
export type AleoDeployment = {
  address: string
  chainId: string
  program: string
  fee: number
}

/**
 * Minimal interface matching @provablehq/aleo-wallet-adaptor-core.
 * Wallets (Leo, Puzzle, Fox, Shield) all implement this.
 */
export type WalletAdapterLike = {
  publicKey: string
  connected: boolean

  // Signing
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }>

  // Transactions
  requestExecution(transaction: AleoTransaction): Promise<{ transactionId?: string }>
  requestDeploy(deployment: AleoDeployment): Promise<{ transactionId?: string }>
  requestTransaction(transaction: AleoTransaction): Promise<{ transactionId?: string }>

  // Records & decryption
  decrypt(cipherText: string, tpk?: string, programId?: string, functionName?: string, index?: number): Promise<string>
  requestRecords(program: string): Promise<unknown[]>

  // Optional — not all wallets support these
  requestBulkTransactions?(transactions: AleoTransaction[]): Promise<{ transactionIds?: string[] }>
  transactionStatus?(transactionId: string): Promise<string>
  getExecution?(transactionId: string): Promise<unknown>
}

// --------------------------------------------------------------------------
// Account adapter
// --------------------------------------------------------------------------

/**
 * Creates an aleo-viem RpcAccount from any wallet adapter.
 */
export function rpcAccountFromAdapter(adapter: WalletAdapterLike): RpcAccount {
  return {
    type: 'rpc',
    address: adapter.publicKey,
    sign: async (message: Uint8Array) => {
      const { signature } = await adapter.signMessage(message)
      return signature
    },
    signMessage: async (message: Uint8Array) => {
      const { signature } = await adapter.signMessage(message)
      return signature
    },
  }
}

// --------------------------------------------------------------------------
// Transport adapter
// --------------------------------------------------------------------------

/**
 * Creates an aleo-viem transport that routes wallet-specific methods
 * through the adapter.
 *
 * This transport handles signing/execution operations. Read operations
 * (getBlock, getBalance, etc.) are NOT handled — pair with http()
 * via fallback() for full coverage:
 *
 *   fallback([transportFromAdapter(adapter), http('https://api.provable.com/v2')])
 */
export function transportFromAdapter(
  adapter: WalletAdapterLike,
  options: { chainId?: string } = {},
): Transport<'custom'> {
  const chainId = options.chainId ?? '1'

  return custom({
    key: 'walletAdapter',
    name: 'Wallet Adapter Transport',
    request: async ({ method, params }) => {
      const p = params as Record<string, unknown> | undefined

      switch (method) {
        case 'executeTransaction': {
          const result = await adapter.requestExecution({
            address: adapter.publicKey,
            chainId,
            transitions: [{
              program: p?.programName as string,
              functionName: p?.functionName as string,
              inputs: p?.inputs as unknown[],
            }],
            fee: Number(p?.fee ?? 0),
            privateFee: (p?.privateFee as boolean) ?? false,
          })
          return result.transactionId
        }

        case 'deployProgram': {
          const result = await adapter.requestDeploy({
            address: adapter.publicKey,
            chainId,
            program: p?.program as string,
            fee: Number(p?.fee ?? 0),
          })
          return result.transactionId
        }

        case 'signMessage': {
          const { signature } = await adapter.signMessage(p?.message as Uint8Array)
          return signature
        }

        case 'decrypt':
          return adapter.decrypt(
            p?.ciphertext as string,
            p?.tpk as string | undefined,
            p?.programId as string | undefined,
            p?.functionName as string | undefined,
          )

        case 'requestRecords':
          return adapter.requestRecords(p?.program as string)

        case 'transactionStatus': {
          if (!adapter.transactionStatus) {
            throw new Error('Wallet adapter does not support transactionStatus.')
          }
          return adapter.transactionStatus(p?.transactionId as string)
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
 * Creates both an aleo-viem account and transport from a wallet adapter.
 *
 *   const { account, transport } = fromWalletAdapter(leoWallet)
 *   const client = createWalletClient({ account, transport })
 */
export function fromWalletAdapter(
  adapter: WalletAdapterLike,
  options: { chainId?: string } = {},
): { account: RpcAccount; transport: Transport<'custom'> } {
  return {
    account: rpcAccountFromAdapter(adapter),
    transport: transportFromAdapter(adapter, options),
  }
}
