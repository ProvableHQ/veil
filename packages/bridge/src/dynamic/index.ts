import type { DynamicEvmWalletClient } from '@dynamic-labs-wallet/node-evm'
import type { DynamicSvmWalletClient } from '@dynamic-labs-wallet/node-svm'
import bs58 from 'bs58'
import { getAddress, toHex } from 'viem'
import { createEvmClient, evmLocalAccount, type EvmClient, type EvmTransport } from '../connections/evm.js'
import type { SolanaClient, SolanaTransport } from '../connections/solana.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import { createRemoteSolanaClient } from '../wallets/remoteSolana.js'

type EvmOptions = Parameters<DynamicEvmWalletClient['getWalletClient']>[0]
type SolanaOptions = Parameters<DynamicSvmWalletClient['signTransaction']>[0]

/**
 * Configures a Dynamic server wallet for EVM bridge transactions.
 *
 * @property client Authenticated Dynamic EVM Node client owned by the caller.
 * @property walletMetadata Full wallet metadata returned by Dynamic wallet creation or import.
 * @property password Optional password for encrypted backup shares. Defaults to omitted; required for password-protected wallets.
 * @property externalServerKeyShares Optional caller-managed MPC shares. Defaults to Dynamic's configured backup retrieval.
 * @property transport Public EVM RPC used for reads, transaction preparation, and broadcast.
 * @example const config: DynamicEvmClientConfig = { client, walletMetadata, transport: evmHttp(rpcUrl) }
 */
export type DynamicEvmClientConfig = Pick<EvmOptions, 'walletMetadata' | 'password' | 'externalServerKeyShares'> & {
  client: Pick<DynamicEvmWalletClient, 'getWalletClient'>
  transport: EvmTransport
}

/**
 * Configures a Dynamic server wallet for Solana bridge transactions.
 *
 * @property client Authenticated Dynamic SVM Node client owned by the caller.
 * @property walletMetadata Full wallet metadata returned by Dynamic wallet creation or import.
 * @property password Optional password for encrypted backup shares. Defaults to omitted; required for password-protected wallets.
 * @property externalServerKeyShares Optional caller-managed MPC shares. Defaults to Dynamic's configured backup retrieval.
 * @property chainId Dynamic network identifier for policy evaluation, such as '101' for Solana mainnet. MUST match the public transport.
 * @property transport Public Solana RPC used for reads and broadcast.
 * @example const config: DynamicSolanaClientConfig = { client, walletMetadata, chainId: '101', transport: solanaHttp(rpcUrl) }
 */
export type DynamicSolanaClientConfig = Pick<SolanaOptions, 'walletMetadata' | 'password' | 'externalServerKeyShares'> & {
  client: Pick<DynamicSvmWalletClient, 'signTransaction'>
  chainId: string
  transport: SolanaTransport
}

/**
 * Connects an existing Dynamic EVM server wallet to the bridge through viem.
 *
 * Construction creates the provider's account adapter without signing or making
 * network requests. Submission signs remotely and uses the supplied RPC for broadcast.
 *
 * @param config Authenticated provider, persisted wallet metadata, signing credentials, and public transport.
 * @returns EVM capabilities accepted by createBridgeClient.
 * @throws BridgeError When the transport is missing or Dynamic returns an incompatible or mismatched account.
 * @example const ethereum = await createDynamicEvmClient({ client, walletMetadata, transport: evmHttp(rpcUrl) })
 */
export async function createDynamicEvmClient(config: DynamicEvmClientConfig): Promise<EvmClient> {
  if (!config.transport) throw new BridgeError('Dynamic EVM client requires a transport')
  const { account } = await config.client.getWalletClient({
    walletMetadata: config.walletMetadata,
    password: config.password,
    externalServerKeyShares: config.externalServerKeyShares,
  })
  if (!account || account.type !== 'local' || typeof account.signTransaction !== 'function') {
    throw new BridgeError('Dynamic must return a viem account with transaction signing support')
  }
  if (getAddress(account.address) !== getAddress(config.walletMetadata.accountAddress)) {
    throw new BridgeError('Dynamic account does not match the configured wallet address')
  }
  // Reuse only the signer so preparation and broadcast honor the caller's transport.
  return createEvmClient({ transport: config.transport, account: evmLocalAccount(account) })
}

/**
 * Connects an existing Dynamic Solana server wallet to the bridge.
 *
 * Construction does not contact Dynamic or the chain. Submission sends the exact
 * message and policy context to Dynamic, verifies its signature, and broadcasts via RPC.
 *
 * @param config Authenticated provider, persisted wallet metadata, signing credentials, network identifier, and transport.
 * @returns Solana capabilities accepted by createBridgeClient.
 * @throws BridgeError When the address, network identifier, or transport is invalid; submission rejects malformed signatures.
 * @example const solana = await createDynamicSolanaClient({ client, walletMetadata, chainId: '101', transport: solanaHttp(rpcUrl) })
 */
export async function createDynamicSolanaClient(config: DynamicSolanaClientConfig): Promise<SolanaClient> {
  if (!config.chainId.trim()) throw new BridgeError('Dynamic Solana chainId must not be empty')
  const { client, walletMetadata, password, externalServerKeyShares, chainId } = config
  return createRemoteSolanaClient({
    transport: config.transport,
    address: walletMetadata.accountAddress,
    sign: async (wire, transaction) => {
      // Dynamic signs message bytes, while policy evaluation consumes the complete wire transaction.
      const signature = await client.signTransaction({
        walletMetadata, password, externalServerKeyShares,
        transaction: toHex(new Uint8Array(transaction.messageBytes)),
        sponsor: false,
        context: { svmTransaction: {
          chainId, method: 'signAndSendTransaction', serializedTransactions: [bs58.encode(wire)],
        } },
      })
      if (typeof signature !== 'string') throw new BridgeError('Dynamic returned an unexpected sponsored transaction')
      try {
        return bs58.decode(signature)
      } catch (cause) {
        throw new BridgeError('Dynamic returned an invalid base58 signature', { cause })
      }
    },
  })
}
